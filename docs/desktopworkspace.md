# Desktop Workspace Interaction Spec

The desktop workspace should apply the following selection and drag behaviours:

- **Click on a non-selected card**: clear any existing selection, then select the clicked card only.
- **Click on a selected card**: keep the selection and open the detail panel for that card (no selection change).
- **Drag on a non-selected card**: clear the selection, select the dragged card, then drag that single card.
- **Drag on a selected card**: drag the entire current selection without altering which cards are selected.
- **Cmd/Ctrl + click on a non-selected card**: add that card to the existing selection.
- **Cmd/Ctrl + click on a selected card**: expand the selection by adding the stack of cards beneath the clicked card.
- **Cmd/Ctrl + drag on a non-selected card**: replace the current selection with the entire stack beneath the pointer, then drag that stack.
- **Cmd/Ctrl + drag on a selected card**: replace the current selection with the stack beneath the pointer, then drag that stack.
- **Touch long-press**: behaves like a stack-select gesture, expanding the selection to the stack under the pressed card without requiring modifier keys.

These rules ensure the selection model remains predictable while supporting stack-aware gestures unique to the desktop workspace.
