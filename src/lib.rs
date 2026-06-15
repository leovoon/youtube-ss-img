use js_sys::{Function, Promise, Reflect};
use serde::{Deserialize, Serialize};
use wasm_bindgen::{prelude::*, JsCast};
use wasm_bindgen_futures::{spawn_local, JsFuture};
use web_sys::HtmlInputElement;
use yew::prelude::*;

const MIN_INTERVAL: f64 = 0.5;
const MAX_INTERVAL: f64 = 60.0;
const DEFAULT_INTERVAL: f64 = 1.0;
const MAX_FRAMES: usize = 200;
const COUNTDOWN_TICK_MS: i32 = 100;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
struct VideoFrame {
    url: String,
    width: u32,
    height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AutoCaptureFlag {
    running: bool,
    interval: f64,
}

struct TimerState {
    interval_id: Option<i32>,
    _closure: Option<Closure<dyn FnMut()>>,
}

fn get_context() -> String {
    web_sys::window()
        .and_then(|w| w.document())
        .and_then(|d| d.get_element_by_id("app"))
        .and_then(|el| el.get_attribute("data-context"))
        .unwrap_or_else(|| "popup".to_string())
}

fn window_function(name: &str) -> Result<Function, String> {
    let window = web_sys::window().ok_or_else(|| "No window available.".to_string())?;
    let value = Reflect::get(&window, &name.into())
        .map_err(|_| format!("{name} bridge missing. Reload extension."))?;
    value
        .dyn_into::<Function>()
        .map_err(|_| format!("{name} bridge invalid. Reload extension."))
}

fn persist_frames(frames: Vec<VideoFrame>) {
    spawn_local(async move {
        let Ok(store_fn) = window_function("storeYoutubeFrames") else {
            show_error("Storage bridge missing. Reload extension.");
            return;
        };

        let Ok(frames_value) = serde_wasm_bindgen::to_value(&frames) else {
            show_error("Could not serialize frames for storage.");
            return;
        };

        let Ok(promise_value) = store_fn.call1(&JsValue::NULL, &frames_value) else {
            show_error("Could not save frames.");
            return;
        };

        let promise: Promise = promise_value.unchecked_into();
        if let Err(error) = JsFuture::from(promise).await {
            let message = error
                .as_string()
                .unwrap_or_else(|| format!("Could not save frames: {error:?}"));
            show_error(&message);
        }
    });
}

fn clear_stored_frames() {
    spawn_local(async move {
        let Ok(clear_fn) = window_function("clearYoutubeFrames") else {
            show_error("Storage clear bridge missing. Reload extension.");
            return;
        };

        let Ok(promise_value) = clear_fn.call0(&JsValue::NULL) else {
            show_error("Could not clear stored frames.");
            return;
        };

        let promise: Promise = promise_value.unchecked_into();
        if let Err(error) = JsFuture::from(promise).await {
            let message = error
                .as_string()
                .unwrap_or_else(|| format!("Could not clear stored frames: {error:?}"));
            show_error(&message);
        }
    });
}

fn show_error(message: &str) {
    web_sys::console::error_1(&message.into());
    if let Some(window) = web_sys::window() {
        let _ = window.alert_with_message(message);
    }
}

fn export_frames(frames: Vec<VideoFrame>, format: &'static str) {
    if frames.is_empty() {
        show_error("No frames to export.");
        return;
    }

    spawn_local(async move {
        let Some(window) = web_sys::window() else {
            show_error("No window available.");
            return;
        };

        let Ok(export_fn) = Reflect::get(&window, &"exportYoutubeFrames".into()) else {
            show_error("Export bridge missing. Reload extension.");
            return;
        };

        let Some(export_fn) = export_fn.dyn_ref::<Function>() else {
            show_error("Export bridge invalid. Reload extension.");
            return;
        };

        let Ok(frames_value) = serde_wasm_bindgen::to_value(&frames) else {
            show_error("Could not serialize frames for export.");
            return;
        };

        let Ok(promise_value) = export_fn.call2(&JsValue::NULL, &frames_value, &format.into())
        else {
            show_error("Could not start export.");
            return;
        };

        let promise: Promise = promise_value.unchecked_into();
        if let Err(error) = JsFuture::from(promise).await {
            let message = error
                .as_string()
                .unwrap_or_else(|| format!("Export failed: {error:?}"));
            show_error(&message);
        }
    });
}

async fn capture_single_frame() -> Result<VideoFrame, String> {
    let window = web_sys::window().ok_or("No window available.")?;

    let capture_fn = Reflect::get(&window, &"captureYoutubeFrame".into())
        .map_err(|_| "Capture bridge missing. Reload extension.")?;
    let capture_fn = capture_fn
        .dyn_into::<Function>()
        .map_err(|_| "Capture bridge invalid. Reload extension.")?;

    let promise_value = capture_fn
        .call0(&JsValue::NULL)
        .map_err(|_| "Could not start frame capture.")?;

    let promise: Promise = promise_value.unchecked_into();
    let value = JsFuture::from(promise).await.map_err(|e| {
        e.as_string()
            .unwrap_or_else(|| format!("Frame capture failed: {e:?}"))
    })?;

    serde_wasm_bindgen::from_value::<VideoFrame>(value)
        .map_err(|e| format!("Invalid capture response: {e}"))
}

#[function_component(App)]
fn app() -> Html {
    let frames = use_state(Vec::<VideoFrame>::new);
    let drag_from = use_state(|| None::<usize>);
    let context = use_state(get_context);
    let is_side_panel = *context == "sidepanel";

    // Auto-capture state
    let auto_capturing = use_state(|| false);
    let interval_secs = use_state(|| DEFAULT_INTERVAL);
    let countdown = use_state(|| DEFAULT_INTERVAL);
    let capture_in_progress = use_state(|| false);

    // Timer internals — Rc<RefCell<>> so interval callback can read/write
    let timer_state = use_mut_ref(|| TimerState {
        interval_id: None,
        _closure: None,
    });
    let countdown_inner = use_mut_ref(|| DEFAULT_INTERVAL);
    let interval_inner = use_mut_ref(|| DEFAULT_INTERVAL);
    // Frames mirror for interval callback — avoids UseStateHandle stale reads
    let frames_inner = use_mut_ref(Vec::<VideoFrame>::new);

    // Load stored frames on mount
    {
        let frames = frames.clone();
        let frames_inner = frames_inner.clone();
        use_effect_with_deps(
            move |_| {
                let frames = frames.clone();
                let frames_inner = frames_inner.clone();
                spawn_local(async move {
                    let Ok(load_fn) = window_function("loadYoutubeFrames") else {
                        show_error("Storage load bridge missing. Reload extension.");
                        return;
                    };

                    let Ok(promise_value) = load_fn.call0(&JsValue::NULL) else {
                        show_error("Could not load stored frames.");
                        return;
                    };

                    let promise: Promise = promise_value.unchecked_into();
                    match JsFuture::from(promise).await {
                        Ok(value) => match serde_wasm_bindgen::from_value::<Vec<VideoFrame>>(value)
                        {
                            Ok(stored_frames) => {
                                *frames_inner.borrow_mut() = stored_frames.clone();
                                frames.set(stored_frames);
                            }
                            Err(error) => show_error(&format!("Invalid stored frames: {error}")),
                        },
                        Err(error) => {
                            let message = error.as_string().unwrap_or_else(|| {
                                format!("Could not load stored frames: {error:?}")
                            });
                            show_error(&message);
                        }
                    }
                });
                || ()
            },
            (),
        );
    }

    // Check auto-capture flag on mount (side panel only)
    {
        let auto_capturing = auto_capturing.clone();
        let interval_secs = interval_secs.clone();
        let countdown = countdown.clone();

        use_effect_with_deps(
            move |_| {
                if is_side_panel {
                    let auto_capturing = auto_capturing.clone();
                    let interval_secs = interval_secs.clone();
                    let countdown = countdown.clone();

                    spawn_local(async move {
                        if let Ok(flag_fn) = window_function("getAutoCaptureFlag") {
                            if let Ok(promise_value) = flag_fn.call0(&JsValue::NULL) {
                                let promise: Promise = promise_value.unchecked_into();
                                if let Ok(value) = JsFuture::from(promise).await {
                                    if let Ok(Some(flag)) =
                                        serde_wasm_bindgen::from_value::<Option<AutoCaptureFlag>>(
                                            value,
                                        )
                                    {
                                        if flag.running {
                                            let clamped =
                                                flag.interval.clamp(MIN_INTERVAL, MAX_INTERVAL);
                                            interval_secs.set(clamped);
                                            countdown.set(clamped);
                                            auto_capturing.set(true);
                                        }
                                    }
                                }
                            }
                        }

                        // Clear the flag regardless
                        if let Ok(clear_fn) = window_function("clearAutoCaptureFlag") {
                            let _ = clear_fn.call0(&JsValue::NULL);
                        }
                    });
                }

                || ()
            },
            (),
        );
    }

    // Side panel: start auto-capture
    let on_start_auto_capture = {
        let auto_capturing = auto_capturing.clone();
        let countdown = countdown.clone();
        let interval_secs = interval_secs.clone();
        let countdown_inner = countdown_inner.clone();
        let interval_inner = interval_inner.clone();
        let timer_state = timer_state.clone();
        let frames = frames.clone();
        let frames_inner = frames_inner.clone();
        let capture_in_progress = capture_in_progress.clone();

        Callback::from(move |_| {
            let interval = (*interval_secs).clamp(MIN_INTERVAL, MAX_INTERVAL);
            interval_secs.set(interval);
            countdown.set(interval);
            *countdown_inner.borrow_mut() = interval;
            *interval_inner.borrow_mut() = interval;

            // Cancel any existing timer
            {
                let mut ts = timer_state.borrow_mut();
                if let Some(id) = ts.interval_id.take() {
                    if let Some(window) = web_sys::window() {
                        window.clear_interval_with_handle(id);
                    }
                }
                ts._closure.take();
            }

            let countdown_state = countdown.clone();
            let countdown_inner_c = countdown_inner.clone();
            let interval_inner_c = interval_inner.clone();
            let frames_state = frames.clone();
            let frames_inner_c = frames_inner.clone();
            let auto_capturing_c = auto_capturing.clone();
            let capture_in_progress_c = capture_in_progress.clone();
            let timer_state_c = timer_state.clone();

            let closure = Closure::wrap(Box::new(move || {
                let current = *countdown_inner_c.borrow();
                let tick = COUNTDOWN_TICK_MS as f64 / 1000.0;
                let new_countdown = (current - tick).max(0.0);

                if new_countdown <= 0.0 {
                    // Check if capture already in progress
                    if *capture_in_progress_c {
                        return;
                    }

                    let interval_val = *interval_inner_c.borrow();

                    // Reset countdown
                    *countdown_inner_c.borrow_mut() = interval_val;
                    countdown_state.set(interval_val);

                    // Check frame cap
                    if frames_inner_c.borrow().len() >= MAX_FRAMES {
                        auto_capturing_c.set(false);
                        let mut ts = timer_state_c.borrow_mut();
                        if let Some(id) = ts.interval_id.take() {
                            if let Some(window) = web_sys::window() {
                                window.clear_interval_with_handle(id);
                            }
                        }
                        ts._closure.take();
                        return;
                    }

                    // Spawn capture
                    let frames_state2 = frames_state.clone();
                    let frames_inner_c2 = frames_inner_c.clone();
                    let auto_capturing_c2 = auto_capturing_c.clone();
                    let capture_in_progress_c2 = capture_in_progress_c.clone();
                    let timer_state_c2 = timer_state_c.clone();

                    spawn_local(async move {
                        capture_in_progress_c2.set(true);

                        match capture_single_frame().await {
                            Ok(frame) => {
                                let mut new_frames = frames_inner_c2.borrow().clone();
                                if new_frames.len() < MAX_FRAMES {
                                    new_frames.push(frame);
                                    persist_frames(new_frames.clone());
                                    *frames_inner_c2.borrow_mut() = new_frames.clone();
                                    frames_state2.set(new_frames);
                                } else {
                                    auto_capturing_c2.set(false);
                                    let mut ts = timer_state_c2.borrow_mut();
                                    if let Some(id) = ts.interval_id.take() {
                                        if let Some(window) = web_sys::window() {
                                            window.clear_interval_with_handle(id);
                                        }
                                    }
                                    ts._closure.take();
                                }
                            }
                            Err(_) => {
                                // Silently skip; timer continues
                            }
                        }

                        capture_in_progress_c2.set(false);
                    });
                } else {
                    *countdown_inner_c.borrow_mut() = new_countdown;
                    countdown_state.set(new_countdown);
                }
            }) as Box<dyn FnMut()>);

            let window = web_sys::window().expect("no window");
            let id = window
                .set_interval_with_callback_and_timeout_and_arguments_0(
                    closure.as_ref().unchecked_ref(),
                    COUNTDOWN_TICK_MS,
                )
                .expect("set_interval failed");

            {
                let mut ts = timer_state.borrow_mut();
                ts.interval_id = Some(id);
                ts._closure = Some(closure);
            }

            auto_capturing.set(true);
        })
    };

    // Side panel: stop auto-capture
    let on_stop_auto_capture = {
        let auto_capturing = auto_capturing.clone();
        let timer_state = timer_state.clone();
        Callback::from(move |_| {
            auto_capturing.set(false);
            let mut ts = timer_state.borrow_mut();
            if let Some(id) = ts.interval_id.take() {
                if let Some(window) = web_sys::window() {
                    window.clear_interval_with_handle(id);
                }
            }
            ts._closure.take();
        })
    };

    // Interval change handler (side panel — live update while running)
    let on_interval_change = {
        let interval_secs = interval_secs.clone();
        let interval_inner = interval_inner.clone();
        let countdown = countdown.clone();
        let countdown_inner = countdown_inner.clone();
        let auto_capturing = auto_capturing.clone();
        Callback::from(move |e: InputEvent| {
            let input: HtmlInputElement = e.target_unchecked_into();
            if let Ok(val) = input.value().parse::<f64>() {
                if (MIN_INTERVAL..=MAX_INTERVAL).contains(&val) {
                    interval_secs.set(val);
                    *interval_inner.borrow_mut() = val;
                    if *auto_capturing {
                        // Reset countdown to new interval immediately
                        countdown.set(val);
                        *countdown_inner.borrow_mut() = val;
                    }
                }
            }
        })
    };

    // Popup: open side panel for auto-capture
    let on_popup_auto_capture = {
        let interval_secs = interval_secs.clone();
        Callback::from(move |_| {
            let interval = (*interval_secs).clamp(MIN_INTERVAL, MAX_INTERVAL);

            spawn_local(async move {
                if let Ok(open_fn) = window_function("openSidePanelForAutoCapture") {
                    if let Ok(promise_value) = open_fn.call1(&JsValue::NULL, &interval.into()) {
                        let promise: Promise = promise_value.unchecked_into();
                        let _ = JsFuture::from(promise).await;
                    }
                }
            });
        })
    };

    // Popup: interval input change
    let on_popup_interval_change = {
        let interval_secs = interval_secs.clone();
        Callback::from(move |e: InputEvent| {
            let input: HtmlInputElement = e.target_unchecked_into();
            if let Ok(val) = input.value().parse::<f64>() {
                if (MIN_INTERVAL..=MAX_INTERVAL).contains(&val) {
                    interval_secs.set(val);
                }
            }
        })
    };

    // Callback: manual grab frame
    let grab_frame = {
        let frames = frames.clone();
        Callback::from(move |_| {
            let frames = frames.clone();
            spawn_local(async move {
                match capture_single_frame().await {
                    Ok(frame) => {
                        let mut new_frames = (*frames).clone();
                        new_frames.push(frame);
                        persist_frames(new_frames.clone());
                        frames.set(new_frames);
                    }
                    Err(error) => show_error(&error),
                }
            });
        })
    };

    let save_png = {
        let frames = frames.clone();
        Callback::from(move |_| export_frames((*frames).clone(), "png"))
    };

    let save_jpeg = {
        let frames = frames.clone();
        Callback::from(move |_| export_frames((*frames).clone(), "jpeg"))
    };

    let clear_frames = {
        let frames = frames.clone();
        let frames_inner = frames_inner.clone();
        let auto_capturing = auto_capturing.clone();
        let timer_state = timer_state.clone();
        Callback::from(move |_| {
            auto_capturing.set(false);
            let mut ts = timer_state.borrow_mut();
            if let Some(id) = ts.interval_id.take() {
                if let Some(window) = web_sys::window() {
                    window.clear_interval_with_handle(id);
                }
            }
            ts._closure.take();
            clear_stored_frames();
            *frames_inner.borrow_mut() = Vec::new();
            frames.set(Vec::new());
        })
    };

    html! {
        <div style="padding: 16px; font-family: sans-serif;">
            <h2>{ "YouTube Frame Grab" }</h2>
            <div style="margin-bottom: 16px;">
                <button onclick={grab_frame}>{ "Grab Frame" }</button>

                if is_side_panel {
                    // Side panel: auto-capture controls
                    <div style="margin: 8px 0; padding: 8px; background: #f5f5f5; border-radius: 4px;">
                        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                            <label for="interval-input">{ "Interval:" }</label>
                            <input
                                id="interval-input"
                                type="number"
                                min={MIN_INTERVAL.to_string()}
                                max={MAX_INTERVAL.to_string()}
                                step="0.5"
                                value={interval_secs.to_string()}
                                oninput={on_interval_change}
                                style="width: 60px; padding: 4px;"
                            />
                            <span>{ "s" }</span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            if *auto_capturing {
                                <button onclick={on_stop_auto_capture}>{ "Stop Auto-Capture" }</button>
                                <span style="color: #555; font-size: 13px;">
                                    { format!("Next: {:.1}s", *countdown) }
                                </span>
                            } else {
                                <button onclick={on_start_auto_capture}>{ "Start Auto-Capture" }</button>
                            }
                        </div>
                        if *auto_capturing {
                            <div style="margin-top: 6px; font-size: 12px; color: #888;">
                                { format!("{} / {} frames", frames.len(), MAX_FRAMES) }
                            </div>
                        }
                    </div>
                } else {
                    // Popup: auto-capture button that opens side panel
                    <div style="margin: 8px 0; display: flex; align-items: center; gap: 6px;">
                        <input
                            type="number"
                            min={MIN_INTERVAL.to_string()}
                            max={MAX_INTERVAL.to_string()}
                            step="0.5"
                            value={interval_secs.to_string()}
                            oninput={on_popup_interval_change}
                            style="width: 50px; padding: 4px;"
                        />
                        <span style="font-size: 13px;">{ "s" }</span>
                        <button onclick={on_popup_auto_capture} style="flex: 1;">{ "Auto-Capture ▸" }</button>
                    </div>
                }

                <button onclick={save_png}>{ "Save PNG" }</button>
                <button onclick={save_jpeg}>{ "Save JPEG" }</button>
                <button onclick={clear_frames}>{ "Clear Frames" }</button>
            </div>
            <div style="border: 1px dashed #999; min-height: 100px; padding: 8px;">
                <h3>{ format!("Frames ({})", frames.len()) }</h3>
                <div style="display: flex; flex-direction: column;">
                    { frames.iter().enumerate().map(|(i, frame)| {
                        let frames_for_delete = frames.clone();
                        let frames_inner_for_delete = frames_inner.clone();
                        let delete_frame = Callback::from(move |_| {
                            let mut new_frames = (*frames_for_delete).clone();
                            if i < new_frames.len() {
                                new_frames.remove(i);
                                persist_frames(new_frames.clone());
                                *frames_inner_for_delete.borrow_mut() = new_frames.clone();
                                frames_for_delete.set(new_frames);
                            }
                        });

                        let drag_from_start = drag_from.clone();
                        let on_drag_start = Callback::from(move |_| {
                            drag_from_start.set(Some(i));
                        });

                        let on_drag_over = Callback::from(|event: DragEvent| {
                            event.prevent_default();
                        });

                        let frames_for_drop = frames.clone();
                        let drag_from_drop = drag_from.clone();
                        let frames_inner_for_drop = frames_inner.clone();
                        let on_drop = Callback::from(move |event: DragEvent| {
                            event.prevent_default();

                            let Some(from) = *drag_from_drop else {
                                return;
                            };

                            if from == i {
                                drag_from_drop.set(None);
                                return;
                            }

                            let mut new_frames = (*frames_for_drop).clone();
                            if from >= new_frames.len() || i >= new_frames.len() {
                                drag_from_drop.set(None);
                                return;
                            }

                            let moved = new_frames.remove(from);
                            let target = if from < i { i.saturating_sub(1) } else { i };
                            new_frames.insert(target, moved);
                            persist_frames(new_frames.clone());
                            *frames_inner_for_drop.borrow_mut() = new_frames.clone();
                            frames_for_drop.set(new_frames);
                            drag_from_drop.set(None);
                        });

                        let drag_from_end = drag_from.clone();
                        let on_drag_end = Callback::from(move |_| {
                            drag_from_end.set(None);
                        });

                        html! {
                            <div
                                key={i}
                                id={i.to_string()}
                                draggable={"true"}
                                ondragstart={on_drag_start}
                                ondragover={on_drag_over}
                                ondrop={on_drop}
                                ondragend={on_drag_end}
                                style="margin: 4px 0; padding: 4px; border: 1px solid #ddd; cursor: grab; background: #fff;"
                            >
                                <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 4px;">
                                    <span>{ format!("Frame {}", i + 1) }</span>
                                    <button type="button" onclick={delete_frame} style="width: auto; padding: 4px 8px; margin: 0;">{ "Delete" }</button>
                                </div>
                                <img draggable={"false"} src={frame.url.clone()} style="max-width: 100%; max-height: 180px; pointer-events: none;" />
                            </div>
                        }
                    }).collect::<Html>() }
                </div>
            </div>
        </div>
    }
}

#[wasm_bindgen(start)]
pub fn run() {
    console_error_panic_hook::set_once();

    let root = web_sys::window()
        .and_then(|window| window.document())
        .and_then(|document| document.get_element_by_id("app"));

    if let Some(root) = root {
        yew::Renderer::<App>::with_root(root).render();
    } else {
        yew::Renderer::<App>::new().render();
    }
}
