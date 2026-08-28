use anlg_calendar_interface::CalendarProviderType;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("provider {provider:?} is not available on this platform")]
    ProviderUnavailable { provider: CalendarProviderType },
    #[error("invalid datetime for field '{field}': {value}")]
    InvalidDateTime { field: &'static str, value: String },
    #[error("apple calendar error: {0}")]
    Apple(String),
}
