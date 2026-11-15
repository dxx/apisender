use futures_util::{stream, StreamExt};
use prost::Message as _;
use prost_types::FileDescriptorSet;
use tonic::transport::{Channel, Endpoint};
use tonic::Status;
use tonic::Request;
use tonic_reflection::pb::v1::{
    server_reflection_client::ServerReflectionClient,
    server_reflection_request::MessageRequest,
    server_reflection_response::MessageResponse,
    ServerReflectionRequest,
};

/// 仅建立反射通道（懒连接），供后续 reflection 调用复用。
pub async fn connect_reflection(endpoint: Endpoint) -> Result<Channel, tonic::transport::Error> {
    endpoint.connect().await
}

/// 通过 gRPC server reflection 拉取 `full_service` 关联的 `FileDescriptorSet` 字节流。
/// 作用与流程：建立连接 → 发送 `FileContainingSymbol` 请求 → 流式接收 FileDescriptorResponse → 合并所有 `FileDescriptorProto` 后编码回字节。
pub async fn fetch_file_descriptor_set(
    endpoint: Endpoint,
    full_service: &str,
) -> Result<Vec<u8>, Status> {
    let channel = endpoint
        .connect()
        .await
        .map_err(|e| Status::unavailable(format!("reflection connect: {}", e)))?;

    let mut client = ServerReflectionClient::new(channel);

    let request = ServerReflectionRequest {
        message_request: Some(MessageRequest::FileContainingSymbol(
            full_service.to_string(),
        )),
        ..Default::default()
    };

    let mut response = client
        .server_reflection_info(Request::new(stream::iter(vec![request])))
        .await
        .map_err(|e| Status::internal(format!("reflection call: {}", e)))?
        .into_inner();

    let mut fds = FileDescriptorSet::default();

    while let Some(resp) = response.next().await {
        match resp {
            Ok(resp) => match resp.message_response {
                Some(MessageResponse::FileDescriptorResponse(fdr)) => {
                    // 一条 FileDescriptorResponse 可能包含多个互相关联的 proto 文件，统一 decode 后合并。
                    for bytes in fdr.file_descriptor_proto {
                        let fdp = prost_types::FileDescriptorProto::decode(bytes.as_slice())
                            .map_err(|e| {
                                Status::internal(format!("decode FileDescriptorProto: {}", e))
                            })?;
                        fds.file.push(fdp);
                    }
                }
                Some(MessageResponse::ErrorResponse(err)) => {
                    return Err(Status::internal(format!(
                        "reflection error code={} msg={}",
                        err.error_code, err.error_message
                    )));
                }
                _ => {}
            },
            Err(e) => {
                return Err(Status::internal(format!("reflection stream: {}", e)));
            }
        }
    }

    let mut out = Vec::new();
    fds.encode(&mut out)
        .map_err(|e| Status::internal(format!("encode FileDescriptorSet: {}", e)))?;
    Ok(out)
}

/// 反射通道句柄：保存 endpoint，每次调用都新开连接。
pub struct ReflectionChannel {
    pub endpoint: Endpoint,
}

impl ReflectionChannel {
    /// 拉取 `full_service` 的 `FileDescriptorSet` 字节（参考自由函数 `fetch_file_descriptor_set`）。
    pub async fn fetch_file_descriptor_set(&self, full_service: &str) -> Result<Vec<u8>, Status> {
        fetch_file_descriptor_set(self.endpoint.clone(), full_service).await
    }
}