# Testing the Sketchplanations Chrome Extension V2

## Overview

This Chrome extension now supports two versions:
- **V1**: Original layout with theme controls, description, and action buttons
- **V2**: Simplified layout focusing on the sketch with system theme preferences

## How to Test Locally

### Method 1: Load as Chrome Extension (Recommended)

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" in the top right
3. Click "Load unpacked" and select this directory
4. Open a new tab to see the extension in action

### Method 2: Test in Browser (Preview)

1. Start a local server:
   ```bash
   python3 -m http.server 8080
   ```
2. Open `http://localhost:8080/test.html` in your browser
3. The extension will load in an iframe for preview

## Features to Test

### Version Toggle
- **Location**: Top left corner
- **Function**: Switch between V1 and V2 layouts
- **Test**: Click V1/V2 links and verify the layout changes

### V1 Features (Original)
- ✅ Theme controls (light/dark/gradient) in top right
- ✅ Description text under sketch
- ✅ Action buttons (Share, Buy prints, Listen)
- ✅ Museum-style side-by-side layout
- ✅ Manual theme selection saved in storage

### V2 Features (New Simplified)
- ✅ No theme controls (hidden)
- ✅ No description text
- ✅ Small text links instead of buttons (Buy prints • Listen to podcast)
- ✅ Centered, sketch-focused layout
- ✅ Automatic system theme detection
- ✅ Cleaner, more minimal design

### Common Features (Both Versions)
- ✅ Frequency control (daily/hourly/each tab)
- ✅ Refresh button for new sketches
- ✅ Bottom links (Subscribe, Feedback, About)
- ✅ Logo and attribution in bottom left
- ✅ Keyboard shortcuts (N for new sketch, V to visit)
- ✅ Mobile responsive design

## Expected Behavior

### V1 → V2 Switch
- Theme controls disappear
- Description text is removed
- Action buttons become small text links
- Layout becomes centered and simplified
- Theme automatically follows system preference

### V2 → V1 Switch  
- Theme controls reappear
- Description text shows
- Small links become action buttons
- Layout returns to museum-style
- Previous theme preference is restored

### System Theme Detection (V2 only)
- Light system theme → Light extension theme
- Dark system theme → Dark extension theme
- Changes automatically when system theme changes

## Troubleshooting

### Extension doesn't load
- Check browser console for errors
- Ensure all files are present (manifest.json, newtab.html, newtab.js, styles.css)
- Verify Chrome extension permissions

### API calls fail
- Extension will show error page with offline sketch
- Check network connectivity
- API endpoint: `https://sketchplanations.com/api/extension/new-tab`

### Version toggle not working
- Check browser storage permissions
- Try refreshing the page after version change
- Clear extension storage if needed

## File Structure

```
/
├── manifest.json          # Extension configuration
├── newtab.html           # Main HTML file
├── newtab.js             # JavaScript functionality
├── styles.css            # All styling (V1 and V2)
├── images/               # Extension icons and assets
├── test.html            # Local testing preview
└── TESTING.md           # This file
```

## Development Notes

- Version preference stored in `chrome.storage.local`
- V2 removes gradient theme option entirely
- V2 uses system `prefers-color-scheme` media query
- Both versions share the same API and core functionality
- Mobile responsive design maintained for both versions