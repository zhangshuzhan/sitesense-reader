use tauri::menu::{AboutMetadata, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::AppHandle;

pub const MENU_ID_QUIT: &str = "app_quit";

pub fn build_app_menu(app: &AppHandle) -> Result<tauri::menu::Menu<tauri::Wry>, String> {
    let quit = MenuItemBuilder::with_id(MENU_ID_QUIT, "Quit RSS Reader")
        .accelerator("CmdOrCtrl+Q")
        .build(app)
        .map_err(|e| e.to_string())?;

    let about = SubmenuBuilder::new(app, "RSS Reader")
        .about(Some(AboutMetadata {
            name: Some("RSS Reader".to_string()),
            version: Some(env!("CARGO_PKG_VERSION").to_string()),
            ..Default::default()
        }))
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .item(&quit)
        .build()
        .map_err(|e| e.to_string())?;

    let file = SubmenuBuilder::new(app, "File")
        .close_window()
        .build()
        .map_err(|e| e.to_string())?;

    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()
        .map_err(|e| e.to_string())?;

    let window = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .close_window()
        .build()
        .map_err(|e| e.to_string())?;

    MenuBuilder::new(app)
        .items(&[&about, &file, &edit, &window])
        .build()
        .map_err(|e| e.to_string())
}
