#[path = "../../../shared/audio_input.rs"]
mod shared;
pub(crate) use shared::AudioInput;

#[cfg(test)]
#[path = "tests/input.rs"]
mod tests;
