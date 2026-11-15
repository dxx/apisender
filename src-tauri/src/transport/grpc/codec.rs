use bytes::{Buf, BufMut, Bytes};
use prost::Message as _;
use prost_reflect::{DynamicMessage, MessageDescriptor};
use tonic::codec::{Codec, DecodeBuf, EncodeBuf};
use tonic::Status;

/// 一个要求/响应都是 `DynamicMessage` 的 gRPC codec，
/// 配合 `prost_reflect::MessageDescriptor` 在运行时序列化和解码消息，不再依赖生成代码。
pub struct DynamicGrpcCodec {
    req_desc: MessageDescriptor,
    resp_desc: MessageDescriptor,
}

impl DynamicGrpcCodec {
    /// 构造 codec：`req_desc` 用于编码请求，`resp_desc` 用于解码响应。
    pub fn new(req_desc: MessageDescriptor, resp_desc: MessageDescriptor) -> Self {
        Self { req_desc, resp_desc }
    }

    /// 取出请求消息描述符。
    pub fn req_desc(&self) -> &MessageDescriptor {
        &self.req_desc
    }

    /// 取出响应消息描述符。
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

/// 单独存放的编码器结构，避免 `&mut self` 期间的 `&MessageDescriptor` 借用冲突。
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

/// 单独存放的解码器，持有响应描述符用于按 `MessageDescriptor` decode 字节流。
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

/// 把 `DynamicMessage` 转成 pretty JSON 字符串；下游通常作为事件 `data` 字段推给前端。
/// 出参：序列化后的 JSON；失败时降级为 `{:?}` 调试字符串并记录 warn 日志。
pub fn dynamic_message_to_json(msg: &DynamicMessage) -> String {
    match serde_json::to_string_pretty(msg) {
        Ok(s) => s,
        Err(e) => {
            log::warn!("[grpc] failed to serialize DynamicMessage as JSON: {}", e);
            format!("{:?}", msg)
        }
    }
}

/// 把 JSON 文本按 `desc` 解析成 `DynamicMessage`；空对象返回空消息。
/// 入参：消息描述符 + JSON 原文。
/// 出参：构建好的 `DynamicMessage`。
/// 错误：JSON 非法/反序列化失败时返回 `String` 描述，便于上层直接展示给前端。
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

    // 先转到紧凑 JSON 字符串再交给 DynamicMessage::deserialize，避免 serde 读指针异常。
    let json_str = serde_json::to_string(&json_value)
        .map_err(|e| format!("re-serialize JSON: {}", e))?;

    let mut de = serde_json::Deserializer::from_str(&json_str);
    let msg = DynamicMessage::deserialize(desc, &mut de)
        .map_err(|e| format!("build DynamicMessage: {}", e))?;
    de.end()
        .map_err(|e| format!("trailing JSON: {}", e))?;

    Ok(msg)
}

/// 防止 `bytes`/`Buf` trait 在某些 feature 裁剪后被自动死的占位。
#[allow(dead_code)]
pub(crate) fn _unused_keep_traits_in_scope() {
    let _: Option<bytes::Bytes> = None;
}