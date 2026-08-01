pub mod interpolator;

pub use interpolator::{
    interpolate, interpolate_grpc_request, interpolate_request, interpolate_ws_request,
    merge_variables, resolve_variable,
};