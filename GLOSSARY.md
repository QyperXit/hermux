# Agents (phone supervisor for Herdr)

A phone web app for watching and driving the Atomic agents and shells that run in Herdr panes on your laptop.

## Terminals

**Terminal**:
Any Herdr pane the app shows: an Agent or a Shell.
_Avoid_: pane (except when talking to herdr), tab, window

**Agent**:
A Terminal whose pane runs a coding agent that herdr recognises, with a status: working, blocked, done, idle or unclear.
_Avoid_: bot, session (a Session is something else, below)

**Shell**:
A Terminal whose pane runs a plain shell or command, with no agent status.
_Avoid_: console, plain pane

**Workspace**:
A Herdr workspace: the group of Terminals that the switcher lists together.
_Avoid_: project, folder

**Session**:
One Atomic conversation in the laptop's session store. An Agent's pane can move to a new Session (for example after /new).
_Avoid_: chat, thread

## Agent screen

**Live screen**:
What the Terminal shows right now, read from herdr and redrawn as it changes.
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

## Home

**Inbox**:
The Agents that need you, plus those that finished since you last opened them in the app.
_Avoid_: notifications, alerts

**Activity**:
The working Agents plus the most recently active others, in order of latest activity.
_Avoid_: feed, recent list
