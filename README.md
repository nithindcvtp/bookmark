# Bookmark Hub

A static bookmark manager that works on GitHub Pages and can optionally sync all bookmark data with Google Sheets.

## GitHub Pages

Upload **the contents of this folder** to the **root of your repository's `main` branch**.

Your site URL will be:

`https://YOUR-GITHUB-USERNAME.github.io/YOUR-REPOSITORY/`

For example:

`https://nithindevtp.github.io/bookmark/`

Do **not** put `index.html` inside a `finder/` folder unless you intentionally want `/finder/` in the URL.

## Google Sheets sync

The website works locally without Google Sheets. To sync between devices, complete the one-time setup in:

`google-apps-script/SETUP.md`

The Google Apps Script backend is included in this package. You must deploy it once as a Google Apps Script Web App and then paste its `/exec` URL and generated key into **Settings -> Google Sheets Sync**.

Never commit the generated secret key to GitHub.

## Included files

- `index.html` - website
- `script.js` - application logic
- `style.css` - styling
- `bookmarks.json` - optional reference/backup data
- `google-apps-script/Code.gs` - Google Sheets backend
- `google-apps-script/SETUP.md` - one-time backend setup
