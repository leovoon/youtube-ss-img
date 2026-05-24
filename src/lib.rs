use js_sys::{Function, Promise, Reflect};
use serde::{Deserialize, Serialize};
use wasm_bindgen::{prelude::*, JsCast};
use wasm_bindgen_futures::{spawn_local, JsFuture};
use yew::prelude::*;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
struct VideoFrame {
    url: String,
    width: u32,
    height: u32,
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

        let Ok(promise_value) = export_fn.call2(&JsValue::NULL, &frames_value, &format.into()) else {
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

#[function_component(App)]
fn app() -> Html {
    let frames = use_state(Vec::<VideoFrame>::new);
    let drag_from = use_state(|| None::<usize>);

    {
        let frames = frames.clone();
        use_effect_with_deps(
            move |_| {
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
                        Ok(value) => match serde_wasm_bindgen::from_value::<Vec<VideoFrame>>(value) {
                            Ok(stored_frames) => frames.set(stored_frames),
                            Err(error) => show_error(&format!("Invalid stored frames: {error}")),
                        },
                        Err(error) => {
                            let message = error
                                .as_string()
                                .unwrap_or_else(|| format!("Could not load stored frames: {error:?}"));
                            show_error(&message);
                        }
                    }
                });
                || ()
            },
            (),
        );
    }
    
    let grab_frame = {
        let frames = frames.clone();
        Callback::from(move |_| {
            let frames = frames.clone();

            spawn_local(async move {
                let Some(window) = web_sys::window() else {
                    show_error("No window available.");
                    return;
                };

                let Ok(capture_fn) = Reflect::get(&window, &"captureYoutubeFrame".into()) else {
                    show_error("Capture bridge missing. Reload extension.");
                    return;
                };

                let Some(capture_fn) = capture_fn.dyn_ref::<Function>() else {
                    show_error("Capture bridge invalid. Reload extension.");
                    return;
                };

                let Ok(promise_value) = capture_fn.call0(&JsValue::NULL) else {
                    show_error("Could not start frame capture.");
                    return;
                };

                let promise: Promise = promise_value.unchecked_into();
                match JsFuture::from(promise).await {
                    Ok(value) => match serde_wasm_bindgen::from_value::<VideoFrame>(value) {
                        Ok(frame) => {
                            let mut new_frames = (*frames).clone();
                            new_frames.push(frame);
                            persist_frames(new_frames.clone());
                            frames.set(new_frames);
                        }
                        Err(error) => show_error(&format!("Invalid capture response: {error}")),
                    },
                    Err(error) => {
                        let message = error
                            .as_string()
                            .unwrap_or_else(|| format!("Frame capture failed: {error:?}"));
                        show_error(&message);
                    }
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
        Callback::from(move |_| {
            clear_stored_frames();
            frames.set(Vec::new());
        })
    };
    
    html! {
        <div style="padding: 16px; font-family: sans-serif;">
            <h2>{ "YouTube Frame Grab" }</h2>
            <div style="margin-bottom: 16px;">
                <button onclick={grab_frame}>{ "Grab Frame" }</button>
                <button onclick={save_png}>{ "Save PNG" }</button>
                <button onclick={save_jpeg}>{ "Save JPEG" }</button>
                <button onclick={clear_frames}>{ "Clear Frames" }</button>
            </div>
            <div style="border: 1px dashed #999; min-height: 100px; padding: 8px;">
                <h3>{ format!("Frames ({})", frames.len()) }</h3>
                <div style="display: flex; flex-direction: column;">
                    { frames.iter().enumerate().map(|(i, frame)| {
                        let frames_for_delete = frames.clone();
                        let delete_frame = Callback::from(move |_| {
                            let mut new_frames = (*frames_for_delete).clone();
                            if i < new_frames.len() {
                                new_frames.remove(i);
                                persist_frames(new_frames.clone());
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