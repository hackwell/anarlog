use anlg_calendar_interface::CalendarProviderType;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("provider {provider:?} is not available on this platform")]
    ProviderUnavailable { provider: CalendarProviderType },
    #[error("operation '{operation}' is not supported for provider {provider:?}")]
    UnsupportedOperation {
        operation: &'static str,
        provider: CalendarProviderType,
    },
    #[error("invalid datetime for field '{field}': {value}")]
    InvalidDateTime { field: &'static str, value: String },
    #[error("apple calendar error: {0}")]
    Apple(String),
    #[error(
        "Microsoft calendar is unavailable in this build: MICROSOFT_CLIENT_ID was not set at build time"
    )]
    MicrosoftNotConfigured,
    #[error("not connected to Microsoft")]
    MicrosoftNotConnected,
    #[error("microsoft sign-in error: {0}")]
    MicrosoftAuth(String),
    #[error("microsoft graph error: {0}")]
    MicrosoftGraph(String),
    #[error("token store error: {0}")]
    TokenStore(String),
}
