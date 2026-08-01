use bytes::{Buf, BufMut, Bytes};
use prost::Message as _;
use prost_reflect::{DynamicMessage, MessageDescriptor};
use tonic::codec::{Codec, DecodeBuf, EncodeBuf};
use tonic::Status;

pub struct DynamicGrpcCodec {
    req_desc: MessageDescriptor,
    resp_desc: MessageDescriptor,
}

impl DynamicGrpcCodec {
    pub fn new(req_desc: MessageDescriptor, resp_desc: MessageDescriptor) -> Self {
        Self { req_desc, resp_desc }
    }

    pub fn req_desc(&self) -> &MessageDescriptor {
        &self.req_desc
    }

    pub fn resp_desc(&self) -> &MessageDescriptor {
        &self.resp_desc
    }
}

impl Codec for DynamicGrpcCodec {
    type Encode = DynamicMessage;
    type Decode = DynamicMessage;
    type Encoder = DynamicEncoder;
    type Decoder = DynamicDecoder;

    fn encoder(&mut self) -> Self::Encoder {
        DynamicEncoder {
            _desc: self.req_desc.clone(),
        }
    }

    fn decoder(&mut self) -> Self::Decoder {
        DynamicDecoder {
            desc: self.resp_desc.clone(),
        }
    }
}

pub struct DynamicEncoder {
    _desc: MessageDescriptor,
}

impl tonic::codec::Encoder for DynamicEncoder {
    type Item = DynamicMessage;
    type Error = Status;

    fn encode(
        &mut self,
        item: Self::Item,
        buf: &mut EncodeBuf<'_>,
    ) -> Result<(), Self::Error> {
        let mut bytes = Vec::with_capacity(item.encoded_len());
        item.encode(&mut bytes)
            .map_err(|e| Status::internal(format!("encode DynamicMessage: {}", e)))?;
        buf.put_slice(&bytes);
        Ok(())
    }
}

pub struct DynamicDecoder {
    desc: MessageDescriptor,
}

impl tonic::codec::Decoder for DynamicDecoder {
    type Item = DynamicMessage;
    type Error = Status;

    fn decode(&mut self, buf: &mut DecodeBuf<'_>) -> Result<Option<Self::Item>, Self::Error> {
        let chunk = buf.chunk();
        if chunk.is_empty() {
            return Ok(None);
        }

        let bytes = Bytes::copy_from_slice(chunk);
        let bytes_len = bytes.len();

        let msg = DynamicMessage::decode(self.desc.clone(), &bytes[..])
            .map_err(|e| Status::internal(format!("decode DynamicMessage: {}", e)))?;

        buf.advance(bytes_len);
        Ok(Some(msg))
    }
}

pub fn dynamic_message_to_json(msg: &DynamicMessage) -> String {
    match serde_json::to_string_pretty(msg) {
        Ok(s) => s,
        Err(e) => {
            log::warn!("[grpc] failed to serialize DynamicMessage as JSON: {}", e);
            // Fall back to debug
            format!("{:?}", msg)
        }
    }
}

pub fn json_to_dynamic_message(
    desc: MessageDescriptor,
    json: &str,
) -> Result<DynamicMessage, String> {
    let json_trimmed = json.trim();
    if json_trimmed.is_empty() {
        return Ok(DynamicMessage::new(desc));
    }

    let json_value: serde_json::Value = serde_json::from_str(json_trimmed)
        .map_err(|e| format!("invalid JSON body: {}", e))?;

    let json_str = serde_json::to_string(&json_value)
        .map_err(|e| format!("re-serialize JSON: {}", e))?;

    let mut de = serde_json::Deserializer::from_str(&json_str);
    let msg = DynamicMessage::deserialize(desc, &mut de)
        .map_err(|e| format!("build DynamicMessage: {}", e))?;
    de.end()
        .map_err(|e| format!("trailing JSON: {}", e))?;

    Ok(msg)
}

#[allow(dead_code)]
pub(crate) fn _unused_keep_traits_in_scope() {
    let _: Option<bytes::Bytes> = None;
}