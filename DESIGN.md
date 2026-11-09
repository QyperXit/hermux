---
name: Agents
description: A Braun-style instrument panel for supervising Atomic agents in Herdr from a phone.
colors:
  signal-orange: "#e2560f"
  signal-orange-highlight: "#ffa266"
  warm-grey-body: "#ebe8e2"
  display-white: "#f7f6f2"
  legend-black: "#121211"
  legend-grey: "#55524c"
  rule-grey: "#cbc6bc"
  key-edge: "#bdb8ad"
  lamp-unlit: "#d6d1c7"
  key-black: "#1d1d1b"
  night-signal-orange: "#cf5418"
  night-signal-orange-highlight: "#f08a4b"
  charcoal-body: "#1c1c1a"
  night-display: "#151514"
  night-legend: "#dcd8cf"
  night-legend-grey: "#9c978d"
  night-rule: "#34332f"
  night-key-face: "#282725"
  night-key-edge: "#0d0d0c"
  night-lamp-unlit: "#393834"
  code-teal: "#00646b"
  link-blue: "#2357a6"
  message-band: "#e2e6dc"
  tool-band: "#e6e3dd"
  night-code-teal: "#6fd3d6"
  night-link-blue: "#8ab4f8"
  night-message-band: "#1f2a1f"
  night-tool-band: "#26262a"
typography:
  headline:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 650
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 550
    lineHeight: 1.25
  body:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.45
    fontFeature: "\"tnum\" 1"
  label:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
  reader:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: "22px"
  output:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "20px"
rounded:
  key: "8px"
  chip: "4px"
  lamp: "50%"
  field: "24px"
spacing:
  unit: "8px"
  gutter: "16px"
  key: "48px"
  row: "56px"
components:
  key:
    backgroundColor: "{colors.display-white}"
    textColor: "{colors.legend-black}"
    rounded: "{rounded.key}"
    height: "48px"
  send-arrow:
    backgroundColor: "{colors.key-black}"
    textColor: "{colors.display-white}"
    rounded: "{rounded.lamp}"
    size: "40px"
    height: "48px"
  saved-command:
    backgroundColor: "{colors.display-white}"
    textColor: "{colors.legend-black}"
    height: "48px"
    padding: "0 16px"
  message-field:
    backgroundColor: "{colors.display-white}"
    textColor: "{colors.legend-black}"
    rounded: "{rounded.field}"
    height: "48px"
    padding: "13px 0 13px 16px"
  list-row:
    textColor: "{colors.legend-black}"
    height: "56px"
    padding: "8px 16px"
  lamp-needs-you:
    backgroundColor: "{colors.signal-orange}"
    rounded: "{rounded.lamp}"
    size: "12px"
  lamp-unlit:
    backgroundColor: "{colors.lamp-unlit}"
    rounded: "{rounded.lamp}"
    size: "12px"
---

# Design System: Agents

## Overview

**Creative North Star: "The Hardware Panel"**

The app reads like a well-made piece of Braun equipment: a warm grey body with black legends, a few physical-feeling keys, and one indicator lamp that lights orange when something needs a human. State is never shown with badges, pills or cards. It's shown with lamps: lit orange, breathing, ringed or dark. Everything else stays quiet, so a glance answers "does anything need me?" in about a second.

The surface is built for reading first. The agent's output sits in a lighter "display window" and reads like a page (D12): the agent's prose in the interface face, with Atomic's highlighting recoloured, and mono kept for tables, boxes and code. Every control (the key row and the chat bar: message box, attach button, "/" and send arrow) sits under the thumb at the bottom, in about 120px (D34), and about 177px while an image is attached (D35). The theme follows the phone's light/dark setting unless the user picks Light or Dark with the theme key (D14). Light is a warm grey body tuned for direct sun; dark is a charcoal model with dimmed legends for a dark bedroom. It rules out a terminal or hacker costume, dashboard clutter, and more colour than the status needs.

**Key Characteristics:**
- One signal colour, orange, used only for "needs you". The only other hues are the agent output's content colours (D12): teal code, blue links and two faint row shades.
- Hairline 1px rules instead of cards, panels or shadows.
- Physical keys with a short press travel.
- Mono only for the agent's own data: tables, boxes, workflow graphs, code and tool rows in the output, code chips, and a working agent's latest line. The agent's prose and everything else is one grotesk.
- An 8px grid: 56px rows, 48px keys, 16px gutters.

## Colors

A restrained hardware palette: warm neutrals and black legends, plus a single orange lamp. Inside the output window only, four content colours carry Atomic's own highlighting (D12).

### Primary
- **Signal Orange** (lit lamp): the "needs you" lamp, the master lamp on the home screen when any agent is blocked, and the blocked note on the agent screen. Its highlight tone makes the radial "lit bulb" centre. In dark mode it drops to **Night Signal Orange**, with **Night Signal Orange Highlight** at the centre, so it doesn't glare.

### Neutral
- **Warm Grey Body**: the app's ground, like the device's casing. In dark mode it becomes **Charcoal Body**.
- **Display White**: the agent output window, key faces and the message field, a lighter face set into the body. In dark mode the output window becomes **Night Display**, the deepest surface, and key faces become **Night Key Face**.
- **Legend Black**: all primary text and icons, at full contrast for daylight. Dark mode uses **Night Legend**, which is softened rather than pure white.
- **Legend Grey**: secondary text (terminal names, durations, the Atomic footer in output, placeholders). It meets 4.5:1 or better on the body in both themes.
- **Rule Grey**: every divider and field border.
- **Key Black**: the send arrow and "Back to agents". It's the only filled dark control, and it inverts to a light key in dark mode.
- **Lamp Unlit**: idle lamps, set in with an inner shadow.
- **Scrim and Sheet Shade** (D18): two shades, not colours, like the key and lamp shades: the dimming behind the switcher sheet and the notifications panel (`rgb(18 18 17 / 0.28)`, dark `rgb(0 0 0 / 0.5)`) and the sheet's shadow (`rgb(60 50 30 / 0.22)`, dark `rgb(0 0 0 / 0.6)`).
- **Viewer Dark** (D36): the picture viewer's own surface, the same in both themes so a picture is always seen on dark: ground `#151514`, legend `#dcd8cf`, secondary `#9c978d`, rule `#34332f`, press `#282725` (the Night tones, fixed).


### Output content (D12)
These appear only inside the agent's output, recoloured from Atomic's terminal palette so they read on both themes. Any colour Atomic uses that isn't listed falls back to Legend Black (Night Legend), so Atomic's orange never reaches the page.
- **Code Teal** (`#00646b`, dark **Night Code Teal** `#6fd3d6`): Atomic's cyan (0,255,255): code, file names, commands and list markers.
- **Link Blue** (`#2357a6`, dark **Night Link Blue** `#8ab4f8`), always underlined: Atomic's orange (255,102,0).
- **Legend Grey** for Atomic's soft greys (256-colour 240–245): thinking text and asides.
- **Message Band** (`#e2e6dc`, dark `#1f2a1f`): rows on Atomic's 30,46,30 background, the user's own messages.
- **Tool Band** (`#e6e3dd`, dark `#26262a`): rows on Atomic's 45,45,48 background, the tool band.
- Bold, italic, underline and inverse (Legend Black ground, Display White text) are kept.

### Named Rules
**The One Lamp Rule.** Orange means "a human is needed here" and nothing else. Errors, primary buttons, links and selection never use it, and neither does the agent's output: Atomic's orange becomes Link Blue.

**The Daylight Rule.** Primary text is Legend Black on the warm body. Grey is only for secondary information and idle states, never for anything the user has to read to act.

## Typography

**Interface Font:** Hanken Grotesk, self-hosted variable 400–700, falling back to system-ui
**Output Font:** JetBrains Mono, self-hosted 400 and 700, falling back to ui-monospace

**Character:** A plain, slightly warm grotesk in the role of Braun's legend lettering, paired with a mono that appears only where columns of terminal text need it.

### Hierarchy
- **Headline** (650, 22px): the "Agents" title on the home screen.
- **Title** (550–650, 17px): agent folder names in rows, the agent-screen header and the All screen title; also the message text (17px, so Android doesn't zoom on focus).
- **Body** (400–650, 15px): section headings, the calm line, the older-sessions key, saved commands, key legends, notes.
- **Reader** (400, 15px, 22px lines, D12): the agent's prose in the output window, set as real paragraphs.
- **Label** (450–600, 13px): terminal names, durations, an Inbox or stopped Activity row's line, the "Older" label, the state word beside the lamp, notices.
- **Output** (400, 13px, 20px lines): the mono parts of the output (box-drawn blocks, code blocks, the tool band, Atomic's chrome) and code chips; and a working agent's latest line on one line, cut with an ellipsis.

### Named Rules
**The Four Sizes Rule.** Only 13, 15, 17 and 22px exist. A new element takes one of them.

**The Mono Is Data Rule.** JetBrains Mono appears only for a terminal's own data: inside the output window (tables, boxes, code, the tool band, code chips and Atomic's chrome, and a plain shell's output, D18), for a working agent's latest line in Activity and on the All screen, and for the last line of any terminal on the All screen and in the switcher sheet (D18). The agent's prose, labels, IDs and keys stay in the grotesk.

## Layout

A single phone-first column capped at 600px and centred on larger screens; the type scale doesn't grow on desktop. Everything sits on an 8px unit with 16px side gutters.

- **Home screen (Inbox D11, Activity D13):** a header (master lamp, title, freshness, notifications bell, theme key) and one summary line ("1 needs you · 1 finished · 2 working"). The freshness line has two states (D20): **"Live"** while the page's event stream is healthy (changes arrive as they happen), and "Live · 14:05", the time of the last refresh, while the page polls instead (the stream is down, or herdr's events aren't reaching the server); `?demo` reads "Sample data · 14:05". Same type, colour and place in both; nothing else on the page changes. Then:
  - **Inbox:** every blocked agent (orange lamp, its latest line in 13px ink, up to two lines), then every agent that finished since the user last opened it in this app (done ring, "Finished: ‹latest line›"). Newest activity first within each group. Inbox rows align to the top, with the lamp on the title line and the time in Legend Black 600.
  - **Activity (D13, "Fade with age"):** one list in order of latest activity (herdr's `state_change_seq`, newest first; herdr's order for ties). It holds every working and unclear agent plus the 5 most recently active other agents that aren't in the Inbox. Of those 5, the newest 3 are at full strength; the other 2 sit under a small "Older" label (13px Legend Grey, 1px rule below) and fade to 0.6 opacity. A working or unclear row is never faded, even when it falls below the label. A working or unclear row shows its latest line in mono on one line; a stopped row shows it in 13px Legend Grey on up to two lines. An agent that just stopped gets a new `state_change_seq`, so it keeps its place at the top.
  - A full-width **"N more older sessions"** key that opens the All screen. The text is always this literal template, for every N, including 0 and 1. N counts only the agents shown in neither the Inbox nor Activity.
  - When the Inbox is empty, a calm line ("Nothing new. 2 working.") takes its place; there is never an empty heading, and a group with no agents has no heading.
  - Each row: lamp, folder in 17px with the terminal's name (below) in 13px Legend Grey, the line, and a time on the right only when the server saw the change (in Activity, stopped rows too). A long folder name is cut with an ellipsis before the name is, which always keeps at least 6em, so two rows in one long folder still tell apart. Every line in a row stays inside it: long unbroken URLs, paths and hashes break anywhere in the two-line rows and end in an ellipsis on one-line rows.
  - When the laptop or herdr can't be reached, the reason ("Can't reach the laptop. Retrying…" or herdr's own message) takes its own line under the title, in Legend Black 600 with the offline icon, and the list below fades to 0.55. The "no agent list yet" note itself never fades.
  - There is more space above a section heading (16px plus 8px) than below it. Rows are at least 56px.
- **All screen (`#/all`):** a 64px header bar (back to home, "All terminals", the count, notifications bell, theme key). While the list can't be refreshed, the count line gives the reason instead ("18 agents · 14 shells · newest first"). Then every agent in one list under an "Agents" heading, blocked agents pinned on top, then newest activity first (herdr's state_change_seq), and under a "Shells" heading (D18) every plain shell in herdr's order (its workspaces' order). Each agent row has its own lamp, folder and name, and its latest line in mono, or its state word ("Idle") when it has none. A shell row (D18) has the drawn shell glyph where the lamp is, the folder, its name, and the last thing it printed in mono, or "Shell". Home's Inbox and Activity list agents only. The two headings show only when there is a shell. Notifications are turned on from the bell in the header (D33, below), not from this list.
- **A terminal's name (D31):** the same everywhere a terminal is named (home and All rows, the switcher sheet and the terminal header): an agent's session; else its Herdr tab's label; else "tab N" when the label is only a number (herdr's default, the number Herdr shows) or empty (then the tab's number); else, with no tab known, its pane ID. A pane ID is never shown as a label otherwise; it is only the name's tooltip (`title`).
- **Agent and terminal screen (D18):** one screen for every pane, an agent or a plain shell. The header bar (64px) holds back, identity and state. The identity's second line is the terminal's name and, when the workspace has more than one pane, the terminals key "· 2 terminals ⌄" (below). A shell's state is the shell glyph and "Shell". The output window takes all remaining height: earlier messages (D16), the "Live screen" divider, then herdr's live screen. A plain shell has no earlier messages (D16 stays agent-only: the page never asks) and no answer keys; its output is shown as printed in 13/20 mono, each row as it came, with nothing joined, boxed or dimmed. The controls stack at the bottom as a compact chat bar (D34, sketch A in [composer-sketch.html](docs/project/composer-sketch.html)), about 120px at 412x915 (293px before): one row of keys (below), and under it the message field with the attach button, the "/" button and the round send arrow inside it. An attached image shows as a chip between the keys and the field (D35), which makes the controls about 177px. Both name the terminal: the field says "Message weather-app" and the arrow is labelled "Send to weather-app" for an agent; a shell's name is its tab name, or "‹folder› shell" when its tab has only a number. The controls never grow wider than the screen: a long name in the placeholder ends in an ellipsis. Number keys and ←/→ appear only while the agent is blocked, at the start of the same row. While typing, the key row hides so the output keeps its height. The key menu, key picker and saved-commands editor (D15) open in place under the keys, set off by a 1px rule; while the picker is open the message box hides, and while the commands editor is open the keys and message box hide. While the agent is blocked the message box is hidden and the blocked note shows, as before.
- Safe-area insets pad the top and bottom.

## Elevation & Depth

The system is flat. Depth comes from tone: the lighter display window and key faces set into the warm body. The only shadows are physical:
- **Switcher sheet (D18) and notifications panel (D33):** the raised surfaces, since they sit over the app: `0 -8px 24px` Sheet Shade, with the Scrim behind it.
- **Key travel:** a 1px edge plus a soft 4px shade, which collapses as the key presses down 1px.
- **Lit lamp:** a small offset shadow under the orange bulb.
- **Unlit lamp:** an inset shade.

### Named Rules
**The No Cards Rule.** Lists and panels are separated by 1px Rule Grey lines, never by raised or rounded containers. The switcher sheet, the notifications panel, the saved-commands popover and the clip menu over the app are the only exceptions. The picture viewer (D36) is not a panel: it replaces the screen.

## Shapes

Keys, fields and outlined keys share one gently rounded corner (8px). The one exception is the chat bar (D34): its message field has a 24px corner (half its 48px height, so one line is a pill) and the send arrow, the attach button and the "/" button inside it are circles. The attached-image chip (D35) has the 8px corner and its thumbnail the 4px one. The saved-commands popover and the clip menu (D37) have the 8px corner. The output's code chips have a 4px corner. Lamps are perfect circles. Rules are hairlines. The switcher sheet (D18) has the same 8px corner on its top edge, and its 4px-tall grab handle has the chip's 4px corner. Nothing else is rounded, and there are no pills beyond the message field.

## Components

### Buttons
- **Key:** a calculator key. The face is Display White with a Legend Black glyph or legend (15px, 600), 48px tall and 8px rounded, with key-travel shadow. Press moves it 1px with no hover colour. A key is at least 48px wide, with 4px of side padding, so its width follows its label: every default and picker-made label (Ctrl C, Shift Tab, Alt X, F12, Bksp) reads in full, on up to two lines, and only a custom label wider than 80px ends in an ellipsis. Keys sit in one row (below).
- **Key row (D34):** every key, the blocked-only answer keys, the user's bar and the + key, in one row that never wraps. Keys are 48px tall and keep their width (`flex: none`); when there are more than fit, the row swipes sideways edge to edge, with the next key cut off at the screen's edge as the cue and no scrollbar or fade. At 412 the default bar (Esc, Tab, ↑, ↓, ⏎, Ctrl C and +) fits without swiping; at 360 the last keys are a swipe away. The row's 4px of bottom padding keeps the key shade from being clipped; the equal negative margin keeps its height at 48px. Blocked agents get the six answer keys at the start of the same row.
- **Hold key (Ctrl C, Ctrl D, Ctrl Z, Ctrl \\):** the same key with a second legend line, "hold", in Legend Grey. Holding for 700ms sweeps a translucent ink fill left to right and then sends; releasing early cancels and shows a hint ("Hold Ctrl D until it fills to send it."). From the keyboard it needs a second press within 2.5s. These four keys are hold keys wherever they appear, default or added (D15); no other key is.
- **Key bar (D15):** the keys after the answer keys are the user's own bar, saved on the phone in `localStorage` (`agents.keys`, a list of key name and label). It starts as Esc, Tab, ↑, ↓, ⏎, Ctrl C. A key that keeps its default label shows its drawn icon if it has one (Tab, arrows, Enter); any other label is its legend, 15px up to three characters, otherwise 13px on up to two lines (one line on a hold key, above "hold"). The answer keys (1–4, ←, →) are not part of the bar: they appear by themselves while the agent is blocked, at the start of the row, and can't be edited.
- **+ key (D15):** the last key in the row, a drawn plus on a transparent face with a 1px Rule Grey inset ring (a tool, not a terminal key). It opens and closes the key picker; while the picker is open its ring is 2px ink.
- **Key picker (D15):** inline under the keys, never a modal. Native controls only: three modifier toggles (Ctrl, Alt, Shift) as 48px labels around real checkboxes, ticked ones with a 2px ink ring; a native `<select>` of the keys in groups (letters, backslash, Esc/Tab/Enter/Backspace, arrows, F1–F12, digits); and a label field (12 characters at most) whose placeholder is the default label. A 13px status line says what will be added ("Adds Ctrl X, labelled “Cut line”.") or why the combination can't be sent ("A letter needs Ctrl or Alt.", "Tab takes Shift only."), and Add key is disabled until it can. A 13px Legend Grey note says "herdr 0.9.5 can't send PgUp, PgDn, Home, End or Delete." The picker offers exactly the server's key grammar: Ctrl or Alt with a letter, Ctrl \\, Shift Tab, Backspace, F1–F12, the arrows, Esc, Tab, Enter and the digits. Add key (Key Black) and Done (outlined) are 48px.
- **Key menu (D15):** a long-press (500ms) on a bar key, or its context menu, opens its menu inline under the keys: the label (and the key's own name if relabelled), then Left, Right, Remove and Done, each 48px and outlined; Left or Right is disabled at the end of the bar. The key gets a 2px ink inset ring while its menu is open. Hold keys send on a long press, so they are edited with the picker open instead: while the picker is open, a tap on any bar key opens its menu and sends nothing. Every change is saved at once.
- **Send arrow (D34, was the full-width Send key):** a round up-arrow button inside the message field at its trailing edge: a 40px Key Black circle with a drawn arrow (stroke 1.75) in a 48px target, bottom-aligned as the field grows. Its accessible label always names the target ("Send to weather-app"); it has no visible text. While a send is in flight it is disabled and busy: the arrow turns into a drawn open ring that turns (900ms; it holds still under reduced motion), the circle dims to 60%, and the label reads "Sending to weather-app". It presses 1px like a key. It never uses orange.
- **Attach button (D35, D37):** a 48px target inside the field, left of the "/" button, with a drawn paperclip (stroke 1.75, 20px) in Legend Grey on a transparent face; a press tints its 40px circle with the body colour, like "/". Its label is "Attach an image"; it is `aria-haspopup="dialog"` with `aria-expanded`, and while the clip menu is open its 40px face has a 2px ink ring (like "/"). It opens the clip menu (below). It hides with the message box while an Agent is blocked.
- **Clip menu (D37):** the paperclip opens a small menu anchored 8px above the message field and as wide as it, the same surface as the saved-commands popover (Display White face, 1px Rule Grey border, 8px corner, Sheet Shade). It is `role="dialog"` named "Attach an image", with two full-width rows 56px tall and a 1px rule between them, each a drawn 20px icon (stroke 1.75) and 15px body text, left-aligned: **Take a photo** (a camera) opens the phone's camera directly (a hidden `<input type="file" accept="image/*" capture="environment">`), and **Choose a picture** (the view key's picture) opens the phone's own picker (a hidden `<input type="file" accept="image/*">`, one file). Either picture becomes the same chip and upload. Focus moves to Take a photo; Esc closes it, and so does a tap anywhere outside it (a tap on the paperclip again too) or picking a row; focus returns to the paperclip (after an outside tap, unless the tap landed on something that took it). "/" and the clip menu close each other, and the agent becoming blocked closes it, so it is still closed when the message box comes back. Hooks: `.attach[aria-controls="clip-menu"]`, `.clip-menu#clip-menu`, `.clip-item.clip-camera`, `.clip-item.clip-gallery`, `.attach-camera`, `.attach-input`.
- **Image chip (D35):** one 48px row between the keys and the message field, 8px apart, only while an image is attached: a Display White face with a 1px Rule Grey border and the 8px corner, as wide as its content (never wider than the controls). In it, a 40px thumbnail of the picked image (4px corner, cover-cropped; a drawn paperclip on the body colour where the browser can't draw the image, e.g. a HEIC photo), the 13px file name (ellipsis when long) and "· size" in Legend Grey, and a 48px remove key with a drawn ✕ (stroke 1.75, 16px, Legend Grey) covering the chip's full height over its border. While it uploads the thumbnail dims and a drawn ring turns over it (900ms; still under reduced motion) and the size reads "Uploading…". If the upload fails the name and size give way to a plain 13px 600 Legend Black message (up to two lines: "Too big. The limit is 15 MB.", "Not an image the laptop can take. Use PNG, JPEG, WebP, GIF or HEIC.", "The laptop didn't answer."), with no orange: the chip is not a "needs you" state. One image at a time: picking another replaces it. The chip clears after a send that went, and stays after one that failed. It hides with the message box while an Agent is blocked.
- **"/" button (D34):** a 48px target inside the field, left of the send arrow, with a 17px 600 "/" in Legend Grey in the grotesk (it is a key, so not mono). Its label is "Saved commands"; it is `aria-haspopup="dialog"` with `aria-expanded`, and while the popover is open its 40px face has a 2px ink ring (like the + key).
- **Focus:** a 2px Legend Black outline, offset 2px, on every control.

### Terminal switcher (D18)
Every pane of a Herdr workspace, agent or plain shell, one tap away from the agent and terminal screen.
- **Terminals key:** the underlined "N terminals" with a drawn down chevron, 13px 600, after the terminal's name on the header's second line and a "·". It is 48px tall; a negative margin keeps the line's own height, so the 64px bar doesn't grow. It shows only when the workspace has more than one pane, counts the panes of `GET /api/workspaces/:id/terminals`, and is `aria-haspopup="dialog"` with `aria-expanded`.
- **Sheet:** a modal dialog (`role="dialog"`, `aria-modal`, labelled by its title) rising from the bottom edge, at most 600px wide and 60% of the screen high. Body Warm Grey with a 1px Rule Grey top edge, the 8px top corners and the Sheet Shade shadow, over the Scrim. A 40×4px grab handle and the title ("hermux · 2 terminals", 15px 650) form the header, at least 56px tall. The page behind is inert. Focus moves to the row marked here, Tab and Shift+Tab stay inside, Esc closes it, and focus returns to the terminals key. A tap on the scrim closes it; the scrim is also a button named "Close terminal list" (outside the Tab order) for screen readers. A swipe down on the header, or on the list while it sits at its top, moves the sheet with the finger and closes it past 72px (or after a 24px flick faster than 0.5px/ms); a shorter one springs back. The slide takes 240ms on an exponential ease-out and holds still under reduced motion.
- **Rows:** one per pane in herdr's order, at least 56px with a 1px Rule Grey rule above: a 24px slot holding the lamp (an agent's state, lit orange only when it needs you) or the drawn shell glyph; the name (15px 650, cut with an ellipsis before the kind), the kind and an agent's state in words (13px Legend Grey, e.g. "atomic · Needs you", "shell"); the last line in mono on one line, cut with an ellipsis; and "here" (13px Legend Grey) or a grey chevron at the right. The row on screen is on Display White. Tapping another row swaps to that terminal without a reload; the hash is replaced, not added, so Back still goes home. Tapping the row marked here closes the sheet.
- **More:** when rows are cut off by the sheet's height, a quiet 13px Legend Grey line under the list says "3 more · scroll". The list scrolls inside the sheet and never moves the page.
- **Gone or changed (D18):** a send refused with `terminal_changed` or `pane_not_found` says so in the notice under the message box ("That terminal changed since this screen loaded. Nothing was sent. Your message is still in the box.") and the screen refreshes to what the pane is now. A pane that has gone shows "Terminal gone". While a linked terminal can't be looked up (the laptop or herdr didn't answer), the header's name line says why ("Can't reach the laptop. Retrying…" or herdr's own words) instead of staying blank, and never "Terminal gone".

### Notifications (D32, D33)
Push notifications are turned on and off from a bell key in the home and All headers, so they are one tap from home instead of at the foot of a list. The bell opens a small panel.
- **Bell key (D33):** a 48px icon key beside the theme key, on the same transparent face and row press tint, in the home header (after the freshness line) and the All header (before the theme key). Its drawn icon (stroke 1.75, round caps, like the theme key's) shows the state, with no new colour and no orange (orange is "needs you" only): a **bell** while notifications are on; a **bell with a slash** while they are off or still being checked; a slashed bell in Legend Grey (the muted look) while the browser blocks them or can't do push at all. Its label names the state and what a tap does ("Notifications: on. Open settings", "… off …", "… checking …", "… blocked …", "… not supported …"); it is `aria-haspopup="dialog"` with `aria-expanded`. `?demo` shows it as off.
- **Panel (D33):** a modal dialog on the switcher sheet's layer and surface (the same scrim, 8px top corners, 1px Rule Grey top edge and Sheet Shade), at most 600px wide, rising from the bottom edge in 240ms on the same ease-out (none under reduced motion). A 56px title ("Notifications", 15px 650), a 1px Rule Grey rule, then the body. The page behind it is inert. Focus moves to the first key that works (or to the dialog itself when none does), Tab and Shift+Tab stay on its keys, Esc and a tap on the scrim close it (the scrim is also a button named "Close notifications", outside the Tab order), and focus returns to the bell. It has no grab handle and no swipe. A change of state redraws its words and keys in place, and focus that was on a key it redrew goes back to the key that works.
- **Line:** 15px Legend Black, the state in words. **Off:** "Off. Turn on to get a notice when an agent needs you or finishes." **On:** "On. This phone gets a notice when an agent needs you or finishes." **Blocked:** "Your browser didn't allow push notifications. Allow notifications for this site in the browser's settings, then reopen the app." **Unsupported:** "This browser can't show push notifications." Checking shows "Checking…"; `?demo` shows "Off. The sample data never turns notifications on."
- **Toggle:** one 48px outlined key (the same face as Edit, Done and the picker's keys: 1px Rule Grey, 8px corner, 15px 600) that names what a tap does: **Turn on** or **Turn off**. It is disabled (grey legend, as any disabled key) while the state is blocked, unsupported, checking or working, and in the demo. It never shows a new colour: the state is carried by the words and the bell.
- **Send test:** a second 48px outlined key beside the toggle, only while it is on. The two share the row's width.
- **Note:** under the keys, 13px Legend Grey, the last result ("Notifications are on.", "Test sent. It should arrive in a moment."); an error is Legend Black 600, like the other error notices. It is one live region (`role="status"`) that is changed in place. Empty, it takes no space.
- **When the browser refuses (D33):** if the browser rejects the subscription, the note says so plainly, in plain text, and names the fix. In Brave (`navigator.brave.isBrave()` answers true): "Brave didn't allow push notifications. In Brave, turn on Settings → Privacy and security → Use Google services for push messaging, then try again." In any other browser: "Your browser didn't allow push notifications. Allow notifications for this site in the browser's settings, then try again." The key stays on Turn on for another try. A failure of the laptop's server is never blamed on the browser: it says "Couldn't turn notifications on. ‹reason›". A permission the user refuses at the browser's prompt leaves the panel blocked, with the Blocked line above.
- **Permission:** the browser's prompt follows only a tap on Turn on. Opening the app, the bell, the panel or the demo never asks.
- **A notification** itself is the operating system's: the title "‹folder› · ‹name› needs you" or "… finished" (D31 naming), the question or latest line as plain text, the app icon, one per agent (a newer one replaces the older). Tapping it opens that Terminal in the app.

### Saved commands (D15, D34)
- **Saved-commands popover (D34, replaces the commands row):** the "/" button opens a small popover anchored 8px above the message field and as wide as it, not a modal: a Display White face with a 1px Rule Grey border, 8px corner and the sheet's shade (`0 -4px 16px` Sheet Shade). It is `role="dialog"` named "Send a saved command to ‹name›" (so even here the target is named), 304px high at most (and half the screen), with the commands scrolling inside it and **Edit** (600) pinned under them behind a 1px rule. Each saved command is a full-width row at least 48px tall, 15px body text left-aligned on one line with an ellipsis (a multi-line command shows on one line), 1px rules between rows. One tap sends the command exactly as written (whitespace and newlines included) through the same prompt path as the message box, and closes the popover. Focus moves to the first command (to Edit when there are none); Esc closes it, and so does a tap anywhere outside it (a tap on "/" again too); focus returns to "/" (after an outside tap, unless the tap landed on a control that took it). Opening the key picker, the commands editor or the clip menu (D37), or the agent becoming blocked, closes it. Edit closes it and opens the editor. The commands are saved on the phone in `localStorage` (`agents.commands`), starting as "continue", "yes, go ahead" and "status?".
- **Saved-commands editor (D15):** inline under the keys' place, never a modal. Each command is a growing text box like the message field (17px, up to 160px), with Up, Down and Delete keys (48px, outlined) under it; the list scrolls inside itself past half the screen. "Add command" adds an empty one and focuses it; "Done" (Key Black) closes the editor and drops empty commands. Every edit is saved as it is typed.

### Picture viewer (D36)
A laptop picture full screen, over everything, from its view key.
- **Surface:** a modal dialog (`role="dialog"`, `aria-modal`, named by the file name and described by its count) covering the whole screen on Viewer Dark in both themes, inside the safe areas. The page behind it is inert. It has no shade or scrim: it is the screen.
- **Top bar:** 64px with a 1px viewer rule under it: a 48px close key with a drawn ✕ (22px, "Close picture"), the file name (15px 600, one line with an ellipsis) over "2 of 3 · 412 × 915 · 184 KB" (13px secondary; the size and dimensions appear once the picture has arrived), and a 48px-tall **Copy path** key (13px 600 secondary). Copy path copies the shown picture's path; the key reads "Copied" for 1.5 s and a hidden status says "Copied ‹path›" (or "Couldn't copy ‹path›.").
- **Stage:** the picture fitted to the space (`object-fit: contain`), centred. "Opening…" shows in its place while it loads. Pinch zooms between the fingers, a double tap zooms to 2.5× where it lands and a second one back to fitted; at most 4×, never smaller than fitted, and while zoomed a drag pans but never pulls an edge inside the screen. The stage takes the fingers (`touch-action: none`).
- **Moving between pictures:** the viewer holds the distinct picture paths of the open screen (Earlier messages and the Live screen) in the order they first appear, taken when it opened, so a refresh under it changes nothing. A sideways swipe of 48px or more (more sideways than upright, only while fitted), the arrow keys, or the 48px previous and next keys in the bottom row (drawn arrows, "Previous picture", "Next picture") move one picture; they stop at the first and last (a disabled key in the rule tone), and with one picture they are hidden. A quiet 13px hint sits between them ("Swipe for the others · pinch to zoom", or "Pinch to zoom"). Each picture starts fitted.
- **Closing:** the close key, Esc, or the phone's Back. Opening adds one history entry (the address doesn't change), so Back closes the viewer instead of leaving the screen; closing with the key or Esc takes that entry back. Focus starts on the close key, Tab and Shift+Tab stay on the dialog's keys, and closing returns focus to the key or path that opened it (to the same path's new key if the Reader redrew it, else to the output).
- **A picture that can't be shown:** a plain 15px message in the picture's place, in the viewer's legend colour, never orange: "Not found on the laptop.", "Not a picture. The laptop shows PNG, JPEG, WebP and GIF files." (also for bytes the browser can't draw), "Too big to show. The limit is 25 MB.", "Not allowed. The laptop shows pictures in your home folder or /tmp only, never in a hidden folder.", "That path can't be opened as a picture.", or "Can't reach the laptop." Close, Copy path and the other pictures still work.
- **Reading it:** `GET api/pictures?path=‹the path, URL-encoded›`, never cached; the bytes are shown from a blob address that is dropped when the viewer moves on or closes, and a picture still loading is cancelled. `?demo` draws three sample sketches itself and asks the laptop for nothing.

### Inputs / Fields
- **Message field (D34):** one Display White face with a 1px rule border and a 24px corner, 48px tall for one line, 17px text (22px lines, 13px of padding above and below, 16px at the left), growing with its text to a maximum of 160px and then scrolling inside itself. The attach button, the "/" button and the send arrow sit inside it at the trailing edge, bottom-aligned as it grows; the text box and all three buttons are 48px targets that cover the field's full height (a -1px margin over its border). Long words, URLs and paths wrap inside it. The placeholder says "Message ‹name›" (the terminal's name for sending, as the arrow's label) in Legend Grey, on one line, ending in an ellipsis when the name is long; the field's hidden label says the same. Focus draws the same 2px ink outline around the whole field. Enter adds a new line; only the send arrow sends.

### Navigation
- **Back:** a 48px icon key in the header bar, a drawn chevron (stroke 1.75). On the All screen it returns home.
- **Theme key (D14):** a 48px icon key at the right of the home and All headers, transparent with the row press tint. Its drawn icon shows the current choice (System: a half-filled circle; Light: a sun; Dark: a moon), and its label names it and the next one ("Theme: System. Switch to Light"). Each tap cycles System → Light → Dark. The choice is stored in `localStorage` (`agents.theme`) and applied by a small script in `<head>` before the first paint, so there is no flash; the theme-color metas follow it (under System each keeps its own media query). Every colour token is `light-dark(light, dark)` on the root's `color-scheme`, which `data-theme` overrides, so the agent screen follows too.
- **Bell key (D33):** a 48px icon key just left of the theme key on the home and All headers, with the same face and press tint; it shows whether notifications are on and opens their panel (see Notifications, above).
- **Focus across refreshes:** home and All are redrawn on every refresh; a focused row, bell key, theme key, Back or older-sessions key keeps its focus.
- **Live updates (D20):** the page keeps one event stream open to the server (`GET /api/events`, server-sent events), fed by the server's read-only subscription to herdr's events. A status change shows at once (the lamp and grouping), and the list and the open screen's terminals are read again straight after. While the stream is healthy there is no 3 s list poll; when it errors, or the server says herdr's events stopped, the page polls again at once and goes back to the stream when it recovers. A hidden page closes the stream (and polls nothing) and opens it again when shown. While Live, a working agent's latest line on home, All and the switcher updates only on herdr events, because herdr 0.9.5 has no output event. A failed list read keeps the 3 s poll running, even while Live, until a read works, and so does a failed read of the open screen's terminals until a read works or the user leaves that screen (home reads no terminals); a failed output read keeps the open terminal's 2 s output re-read running the same way, so the "Retrying…" notice never outlives the failure.
- **Rows** are whole-row links with a press tint of Display White. They carry no chevrons.
- **Older-sessions key:** a full-width 48px key with a 1px Rule Grey border, 8px rounded, 15px body text ("11 more older sessions") and a grey chevron on the right. It has the same press tint as rows.

### Indicator Lamp
The signature component, 12px (16px for the home screen's master lamp):
- **Needs you:** lit Signal Orange with a radial highlight.
- **Working:** solid Legend Black (Night Legend in dark mode), breathing between 100% and 30% opacity over 2.4s. It holds steady under reduced motion.
- **Done:** a 2px ring. A finished agent in the Inbox always shows it.
- **Idle:** Lamp Unlit, set in.
- **Unclear:** a dotted ring.

### Output Window (Reader, D12)
The agent's recent output on Display White, read from herdr as styled text (`agent read --format ansi`; the plain read is the fallback) and set like a page. Only SGR codes are used, and they become the content colours above; every other escape sequence is dropped and all text is HTML-escaped, so the output can never inject markup.
- **Prose:** Atomic's own wraps are joined into paragraphs with the same rule as the latest line (a line about as long as a wrapped line that doesn't end a sentence continues onto the next; a list item or command starts its own line). Reader face, 15/22.
- **Lists:** numbered and bulleted items hang their marker (1.4em hanging indent). Atomic colours the marker as code, so it shows as a chip, as in the sketch.
- **Code spans:** code-coloured runs inside prose become mono chips: 13px JetBrains Mono in Code Teal on the Warm Grey Body, 4px corner.
- **Box-drawn blocks (D14):** every run of box-drawing lines (Atomic's workflow graph, ╭╮╰╯ and ┌┐└┘ panels such as WORKFLOW RELOAD, ├┼┤ tables, Markdown tables and tree rows) is one 13/20 mono block that keeps its terminal layout exactly: each line as drawn, leading spaces included, never wrapped or joined. A block wider than the screen scrolls sideways inside its own row, running edge to edge, with no scrollbar (D38); as on the key row, the block cut off at the screen's edge is the cue. The page itself never scrolls sideways. When the screen shows Atomic's full-screen workflow graph (its "│ GRAPH │" pill among the last lines), the whole screen is one block; Atomic pins the pill to the screen's bottom, so a run of more than 3 blank rows (that screen filler) shrinks to 3. **A refresh never moves a block (D29):** the Live screen is redrawn in place; a block whose text is unchanged is kept as it is, and one whose text changed (a ticking timer) keeps its element, matched by its kind and its order among the blocks, so its sideways and vertical scroll position, and a scroll in progress, stay where they are.
- **Mono, unjoined:** fenced code blocks and the Tool Band stay in 13/20 mono with their own spacing; their long lines wrap anywhere rather than overflow. The Message Band keeps its rows unjoined in the Reader face. Bands run edge to edge with 8px padding.
- **Rules:** separator lines become 1px rules.
- **Selection bar (D17):** in Atomic's question dialogs (single- and multi-select) the option under Atomic's cursor is a **Selection Bar**: an Ink Key (the key-dark token, `#1d1d1b`, dark `#dcd8cf`) bar running edge to edge, 40px high on the 8px grid, with the label in Key Face ink at 700 and a drawn chevron marker in a 16px slot at the left (no ❯ glyph). The other options are plain rows in ink, same height, with the slot empty. Ticked boxes (`[✔]`) are drawn 16px squares with a 2px ink border, filled with ink and a drawn check; unticked boxes (`[ ]`) are the same square empty; on the bar the pair inverts so both stay readable. An answered option Atomic marks with ✔ reads as a ticked row without the bar. Rows are found by their shape (a cluster of at least two numbered rows with a ❯ pointer among them, plus a Next or Submit row under a multi-select), never by Atomic's orange, so Atomic's accent colour and bold on the row never reach the page: no orange, no blue, no underline, and nothing that can be mistaken for a link. State is also in visually hidden text ("selected", "ticked", "not ticked") for screen readers. A numbered list in the agent's own prose is not changed. Descriptions stay muted prose under their option.
- **Workflow picker (D29):** Atomic's `/workflow connect` picker (its ╭── Connect to workflow run ──╮ box) shows the run under Atomic's cursor as the same Selection Bar, and every other run as a plain option row. A run's id row and its name row (name, elapsed time, stages) make one row. The run is found by its shape (an id row, then its name row, inside that box) and Atomic's bold across the whole row, never by Atomic's accent shade. The box's title, filter and group rows and its bottom edge stay a box-drawn block around the rows. **The box's left edge runs unbroken past the run rows (D38):** each run row carries a 1px line in the row's own ink (Key Face ink on the Selection Bar, ink on a plain row) at the centre of the block's first mono column, through the row's full height, so the │ of the block above meets the │ of the block below in light and dark. Question dialogs, which are not in a box, draw no edge.
- **Links and paths (D29):** an `http://` or `https://` address in the Reader (prose, bands, options and box-drawn blocks) and in Earlier messages is a real link in Link Blue, underlined, opening in a new tab (`rel="noopener noreferrer"`). Punctuation after it (`. , ; : ! ?`, and a closing bracket it didn't open) isn't part of it. Other schemes stay text, and an address inside a code chip stays text. A laptop path (`/tmp/…`, `/home/…`, `~/…`) is never a link: in prose and mono rows a quiet 13px 600 Legend Grey **copy** key follows it, 48px tall with a negative margin so the line keeps its height; in a box-drawn block, where a key would move the columns, the path has a dotted Legend Grey underline and a long-press copies it. Copying uses the clipboard and the notice under the message box says "Copied ‹path›". Atomic's chrome and a plain shell's output stay as printed.
- **View key (D36):** a picture path (its name ends in `.png`, `.jpg`, `.jpeg`, `.webp` or `.gif`, any case) also gets a **view** key right after its copy key, in the Reader (prose, bands, options, mono rows) and in Earlier messages: the same quiet 13px 600 Legend Grey key, 48px tall and at least 48px wide with the same negative margin, with a drawn 16px picture (a framed hill and sun, stroke 1.75) before the word. Its label is "View ‹path›". In a box-drawn block, where a key would move the columns, a tap on the picture path opens it (it is a button named "View ‹path›" for the keyboard and screen readers, Enter or Space) and a long-press still copies it without opening the viewer. The path has a transparent hit area 48px tall and at least 48px wide (a `::after` centred on the text, no visible change and no extra scrolling in the block). A picture path with a part starting with `.` (a hidden folder or file, `.` or `..`) gets the copy key but no view key and no tap-to-view, since the laptop never shows it (D37). Other paths, web addresses, Atomic's chrome and a plain shell's output get no view key.
- **Chrome:** everything of Atomic's own from its usage line down (the usage line, prompt box with any draft, footer, "esc to interrupt" and task line, the BACKGROUND run panel and the scroll hint) stays dimmed in Legend Grey mono so the agent's words lead. The BACKGROUND panel is one dimmed box-drawn block. Without a usage line, the last closed prompt box that has Atomic's footer under it starts the chrome, however far from the end. The agent's own rules and ❯ above that are never dimmed. **A box in the prompt box's place (D38):** when Atomic draws its own ╭…╰ box straight under the usage line instead of the prompt box (the `/workflow connect` picker), with its footer somewhere below, the usage line is chrome, the box is the screen's content, and from the line under its bottom edge down is chrome again: the key-hint line is its own dimmed mono line, then the footer, the BACKGROUND panel and the scroll hint. The footer is found in both of Atomic's forms, "(provider) model level • ~/folder" and "provider/model  level • ~/folder" (two spaces before the level). Atomic's scrollbar column (│, ┃ or █) and "Jump to latest message" hint are removed; where the hint is drawn over the middle of a long unwrapped row, the row ends there.
- **Earlier messages (D16):** above the live screen, the output holds earlier messages from Atomic's own session store, set in the same Reader style: the user's messages on the Message Band (line breaks kept), the agent's markdown as Reader prose (soft wraps joined, hanging list items, bold headings, 1px rules, code spans as chips, fenced code and tables as one mono block that scrolls sideways), and each tool call as one 13/20 mono row on the Tool Band (the tool's name in bold, then a short summary of its main argument, at most 80 characters). Thinking and images never show. A quiet 13/20 Legend Grey line at the top says what is happening ("Scroll up for earlier messages", "Loading earlier messages…", "Start of the conversation", "Showing the 300 earlier messages nearest the screen", or, for a pane whose session can't be matched, "No earlier messages: this pane's Atomic session wasn't found.", or with messages already shown, "Earlier messages unavailable: this pane's Atomic session wasn't found."). **A no-match is not final** (review round 3): the page asks again, but only when the live screen has changed since that answer, on a scroll to the top or on a refresh while the view sits within 240px of the top, so at most one request per refresh and none while the screen is unchanged; messages already shown stay), and a 1px Rule Grey divider labelled "Live screen" in 13px Legend Grey marks where herdr's screen starts. Scrolling within 240px of the top loads the next page (30 messages) above, and the view doesn't move: the page adds exactly the height it inserted to the scroll position (browser scroll anchoring is off on the output). At most 300 earlier messages are kept; then loading stops and the top line says so. The 2 s refresh redraws only the live screen and never fetches earlier messages again. **The Join stays intact while the agent works** (review round 1): once earlier messages are shown, a refresh whose live screen has lost its old top lines (text scrolled off) asks once for what scrolled off, from the last Join on, and adds it at the end of the earlier messages, just above the divider; a message that was only partly above the screen is replaced whole in its place. A refresh where nothing scrolled off asks for nothing. Followed to the bottom, the view stays at the bottom; with the divider above the view, what is in view doesn't move; past 300 the oldest earlier messages go first and the top line says so. If what scrolled off can't be fetched (the pane's session can't be matched right now), a 13/20 Legend Grey line "Some messages may be missing here." sits just above the divider instead of implying the two are continuous; the next scroll-off tries again from the same point and the line goes when it is filled. If more than 100 messages scrolled off between two refreshes, the earlier messages start again from the screen. So do they when the pane's Atomic session changes (`/new`, `/resume`, `/fork` in the same folder): every answer carries its session, and one from a different session than the first page is never joined to the messages shown (review round 2). All the old ones are removed, the gap line goes, and the new session's first page loads from the screen (at once if the view was in the earlier messages, otherwise when the user scrolls up), so no message of one session is ever drawn under another's. No new colours: the bands, rule and greys are the existing tokens.
- Leading indentation is capped at 12ch and runs of blank lines collapse to one 8px gap. The output isn't re-rendered when the text is unchanged. While the event stream is healthy (D20) it is read again when an event says that pane changed (a status change, a title or pane update), and every 2 s only while the terminal may be printing: a working or unclear agent, or a plain shell (herdr 0.9.5 sends no event for new output). An idle, done or blocked agent's output is re-read on its next status change or after a send from this page. While the page polls, the output refreshes every 2 s as before. A "Latest" key (48px, Key Black) appears when new output arrives while the user is scrolled up. When output already on screen can't be refreshed, the notice under the message box says "Output not updated. ‹reason› Retrying…" until a read works again.

### Latest Line (D11, D13)
The last line the agent itself wrote, from the server's plain read of its recent output, with Atomic's own wrapped sentence joined back together. Atomic's own screen is never shown as the agent's words: from the usage line down (prompt box, a draft typed into it, footer, "esc to interrupt", task line, background-run panel), rules, spinner-only lines ("∀ Gestating..."), key hints, tool timers, the rows Atomic adds to a question dialog ("Type something.", "Chat about this"), the scrollbar column and blank lines are skipped. While a pane shows Atomic's full-screen workflow graph there is no line. A pane that closed since the list just has no line; a read that failed for any other reason says so in the line's place, in 13px Legend Grey on one line: "Couldn't read its latest line. ‹reason›" (home's Inbox and Activity, the All screen and the switcher sheet; a finished Inbox row keeps "Finished"). The other rows are unaffected, and the pane is read again on the next refresh.

Blocked, working, unclear and done agents are read on every list refresh (a read is reused for 3 s while `state_change_seq` is unchanged). Idle agents are never all read: only the 8 most recently active idle agents, plus up to 5 idle panes the page names because its Activity list shows them (`GET /api/agents?lines=‹pane IDs›`; names that aren't listed idle panes are ignored). The page names the panes it showed last time; if a new idle Activity row still comes back unread, it asks once more at once, naming it. An idle pane is read once per `state_change_seq` and not again while that number is unchanged.

### Finished, and Opened (D11)
An agent counts as **finished** while herdr's `completion_seq` for it is newer than the one stored when the user last opened it in this app. The page stores that number per pane in `localStorage` each time the agent's screen is open (on opening, and on each refresh while it stays open), so a completion watched there doesn't come back. The first time the app sees a pane it stores a baseline for it under the same key. On the app's first load (nothing stored yet) the baseline is the pane's current `completion_seq` if it isn't done, so completions from before the app was used don't fill the Inbox, or nothing (any completion is new) if it is done or has no completion yet. A pane first seen later, once the app is in use, always starts with nothing: the user has opened none of its completions here, so a new agent that finished and was cleared on the laptop while the phone wasn't looking still shows in the Inbox. A done agent the user has never opened here therefore stays in the Inbox when herdr turns it idle (cleared on the laptop) until it is opened in the app, and opening it overwrites the baseline. An agent appears once on home: blocked or finished in the Inbox, otherwise in Activity when it is working, unclear or among the 5 most recent others, otherwise only behind the older-sessions key. The sample data (`?demo`) uses real pane IDs, so the demo keeps its opened completions in memory and never writes to `localStorage`.

### Times (D11, D13)
A duration ("4 min", "now") comes only from a change the server saw itself: the agent's status or `state_change_seq` differed from the server's previous look, taken at most 10 s earlier. An agent seen for the first time, or changed while nobody was looking, shows no time until its next change. A time never comes from the server's start. Stopped rows in Activity follow the same rule: a just-stopped agent says how long ago it stopped, and one whose stop the server didn't see shows no time. Idle rows on the All screen show no time.

## Do's and Don'ts

### Do:
- **Do** show state with a lamp plus a word (e.g. "Needs you · 4 min"), never with a coloured pill. Show the time only when the server saw the change.
- **Do** keep every interactive target at 48px or more on the 8px grid.
- **Do** name the target on every sending control: the message field's placeholder, the send arrow and the saved-commands popover.
- **Do** use drawn SVG icons (stroke 1.75, round caps) for keys; unicode arrows are not icons.

### Don't:
- **Don't** use orange for anything except "needs you": not for errors, not for the send arrow, not for links.
- **Don't** add cards, shadows or panels to group content; use 1px rules and spacing. The switcher sheet (D18), the notifications panel (D33), the saved-commands popover (D34) and the clip menu (D37), which share one shade, are the only raised surfaces, because they sit over the app.
- **Don't** dress the app as a terminal: no green-on-black, no mono outside the agent's own words, no fake CRT effects.
- **Don't** add dashboard furniture such as stats, charts or counters beyond the one summary line.
