# hermux

The words hermux uses for the agents and shells it shows from Herdr panes.

## Terminals

**Terminal**:
Any Herdr pane the app shows. A Terminal is either an Agent or a Shell.
_Avoid_: pane (except when talking to herdr), tab, window

**Agent**:
A Terminal running a coding agent that herdr recognises. It has a status: working, blocked, paused, done, idle or unclear.
_Avoid_: bot, session (a Session is something else, below)

**Shell**:
A Terminal whose pane runs a plain shell or command, with no agent status.
_Avoid_: console, plain pane

**Workspace**:
A Herdr workspace. The switcher lists its Terminals together.
_Avoid_: project, folder

**Session**:
One Atomic conversation in the laptop's session store. An Agent's pane can move to a new Session (for example after /new).
_Avoid_: chat, thread

## Agent screen

**Live screen**:
What the Terminal shows right now, streamed from herdr and redrawn as it changes.
_Avoid_: output (in prose), viewport, scrollback

**Earlier messages**:
An Agent's older messages from its Session, loaded page by page above the Live screen as you scroll up. Shells have none.
_Avoid_: history (in prose), scrollback, backlog

**Join**:
The place where Earlier messages meet the Live screen, with no message repeated or missing across it.
_Avoid_: seam (that word is reserved for the architecture meaning)

**Latest line**:
The last line an Agent or Shell wrote, shown in lists, without Atomic's own screen furniture.
_Avoid_: last output, preview

**Picture viewer**:
The full-screen view of a picture file on the laptop, opened from its path in the Live screen or Earlier messages, with the screen's other pictures a swipe away.
_Avoid_: lightbox, gallery, preview

**File sheet**:
The sheet raised by a laptop file's "file" key in the Live screen or Earlier messages: the file's name, size, changed time and path, with Open, Save, Share… and Copy path.
_Avoid_: download dialog, file card, file viewer

**Subagent**:
A helper agent an Agent on Atomic 0.10 starts. Atomic lists its subagents in its agent panel and shows one at a time on the main screen; one waiting for an answer makes its Agent need you.
_Avoid_: workflow, child, worker (that is one subagent's name)

**Paused**:
An Agent on Atomic 0.10 whose only unfinished Subagents are ones you paused (Esc on a shown Subagent) and whose own turn is over. herdr still calls it working; hermux reads it from main's screen, or when Atomic lists the helper nowhere, from its saved session, and shows "‖ Paused" in Activity, quietly: no lamp, no Inbox, no Notification. A message to the paused Subagent carries it on.
_Avoid_: stopped (Atomic's word for a Subagent ended for good), idle, stuck

**Paused card**:
The card above the keys while an Agent is Paused and main is on Atomic's screen: "A helper is paused · send it a message to carry on" and Show helpers, which opens Atomic's /tasks list, where each paused Subagent's row opens it.
_Avoid_: question card (that is for a Subagent waiting for an answer)

**Question card**:
The card above the keys while a Subagent waits for an answer and no question is on the Live screen: "‹name› is asking · ‹its task›", its question when the main chat shows it, and Open ‹name›'s question, which brings that Subagent's chat, and its question, to the screen.
_Avoid_: banner, prompt card, alert

**Subagent strip**:
The strip under the header while a Subagent is on Atomic's screen: its name, what it is doing, and Back to main.
_Avoid_: breadcrumb, tab

**Agent's question**:
Atomic's own question to you (its ask_user_question box, an Agent's or a Subagent's, or its trust prompt), drawn on the Live screen as its header, the question and an option row for each answer, tapped to answer.
_Avoid_: dialog, popup, question card (that points to a Subagent's)

**Typing field**:
The field inside an Agent's question that takes your own words: "Type something.", "Chat about this" or the notes. While a question is on screen, only with its field open does the Agent take text from the message box.
_Avoid_: input, text box, other

## Notifications

**Notification**:
A push message to the phone when an Agent needs you (it is blocked, or a Subagent of it waits for an answer) or has finished (it went from working, or Paused, to done). It names the Agent's folder and name, and tapping it opens that Terminal. Not the Inbox, which is a list inside the app.
_Avoid_: alert, ping

## Home

**Inbox**:
The Agents that need you, plus those that finished since you last opened them in the app.
_Avoid_: notifications, alerts

**Activity**:
The working and Paused Agents plus the most recently active others, in order of latest activity.
_Avoid_: feed, recent list
