use super::*;

#[test]
fn cue_restart_and_output_recovery_keep_the_original_track_bounds() {
    let mut player = InnerPlayer::new().unwrap();
    player.playback_start = 120.0;
    player.playback_end = Some(190.0);
    player.seek_base = 155.0;

    let restart = player.playback_range(None);
    assert_eq!(restart.start, 120.0);
    assert_eq!(restart.end, Some(190.0));

    let resume = player.playback_range(Some(player.position()));
    assert_eq!(resume.start, 155.0);
    assert_eq!(resume.cue_start, Some(120.0));
    assert_eq!(player.playback_range(Some(2.0)).start, 120.0);
    assert_eq!(player.playback_range(Some(230.0)).start, 190.0);
}
use std::sync::atomic::{AtomicUsize, Ordering};

#[test]
fn decode_failure_mid_stream_emits_source_error() {
    let shared = Shared::new(48_000, 2);
    shared.mark_decode_failed();

    assert!(matches!(
        playback_completion_event(&shared, 120.0, 30.0),
        PlayerEvent::SourceError
    ));
}

#[test]
fn decode_failure_near_end_is_treated_as_ended() {
    let shared = Shared::new(48_000, 2);
    shared.mark_decode_failed();

    assert!(matches!(
        playback_completion_event(&shared, 120.0, 118.0),
        PlayerEvent::Ended
    ));
}

#[test]
fn unknown_duration_failure_emits_source_error() {
    let shared = Shared::new(48_000, 2);
    shared.mark_decode_failed();

    assert!(matches!(
        playback_completion_event(&shared, 0.0, 30.0),
        PlayerEvent::SourceError
    ));
}

#[test]
fn stale_output_failure_callback_is_ignored() {
    let mut player = InnerPlayer::new().unwrap();
    let calls = Arc::new(AtomicUsize::new(0));
    let calls_for_event = Arc::clone(&calls);
    player.set_event_callback(Arc::new(move |event| {
        if matches!(event, PlayerEvent::OutputFailed) {
            calls_for_event.fetch_add(1, Ordering::Relaxed);
        }
    }));

    let generation = player.reserve_output_generation();
    let callback = player.make_failure_callback(generation);
    callback();
    assert_eq!(calls.load(Ordering::Relaxed), 1);

    player.reserve_output_generation();
    callback();
    assert_eq!(calls.load(Ordering::Relaxed), 1);
}

mod preload;
