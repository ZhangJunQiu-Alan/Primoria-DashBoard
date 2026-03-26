use tauri::{
    AppHandle, Manager, WebviewUrl, WebviewWindowBuilder,
};

#[tauri::command]
fn open_todo_popout(app: AppHandle, widget_id: String, title: String) {
    let label = format!("todo-popout-{}", widget_id);

    // If window already exists, focus it
    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.show();
        let _ = win.set_focus();
        return;
    }

    let url = format!("popout.html?widgetId={}&title={}", widget_id, title);

    let _win = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(url.into()))
        .title(&title)
        .inner_size(300.0, 440.0)
        .min_inner_size(240.0, 300.0)
        .always_on_top(true)
        .decorations(true)
        .resizable(true)
        .build()
        .unwrap();
}

#[tauri::command]
fn close_todo_popout(app: AppHandle, widget_id: String) {
    let label = format!("todo-popout-{}", widget_id);
    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.close();
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            open_todo_popout,
            close_todo_popout,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
