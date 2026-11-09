# A three-minute demo

A script for showing Craftly to somebody (an investor, a user, a team), written from what the product does today. Every step uses a control that exists and was driven by the browser journeys; nothing here is a mock-up. It is also the first item of milestone M0 in [`INVESTOR-READINESS.md`](INVESTOR-READINESS.md): the 90-second video is this script recorded.

**Set up (two minutes, once).** Two terminals in the project folder: `npm run dev` (the editor, http://127.0.0.1:5173) and `npm run server` (the live server, http://127.0.0.1:8787). Two browser windows side by side, the second in a separate profile or a private window so that it has its own library, each about 1440 x 900.

## The path

1. **Make something good in 30 seconds (window A).** Home > **Presentation** > pick a template in the side panel (or start empty). Change the heading text, change a colour from the toolbar. *Point out:* everything is on this device; it works offline; no account.
2. **Draw a diagram (30 seconds).** In **Elements > Shapes** add two shapes (or use the ones of the template), select the first, **Shift-click** the second, and choose **Connect** in the toolbar. An arrow appears, attached to both. Drag one shape: the arrow follows, in one step of undo. *Point out:* this is the start of diagrams and flowcharts.
3. **Share live (30 seconds).** **Share > Work together**, keep the server address `http://localhost:8787`, choose **Start live session**. Two links appear: an **edit link** and a **view link**. A green **Live** mark appears in the top bar. *Point out:* the server is yours; the links carry the keys after the `#`; nothing leaves your device until now.
4. **Join (30 seconds).** Copy the edit link, paste it in window B. The same design opens, **Live**. In B drag a shape: it moves in A at the same moment. In A change a colour while B moves the same shape: both changes stay. *Point out:* changes merge by property, not by file.
5. **Undo is yours (15 seconds).** In A press **Ctrl+Z**: only A's last change goes back, B's stay.
6. **Look only (15 seconds).** Paste the **view link** in a third window: the design opens as **Live, view only**, nothing can be changed, and it follows the others.
7. **Go offline (15 seconds).** Stop the server (Ctrl+C), keep editing in A: the mark says **Reconnecting...** and the design keeps working; start the server again: it catches up and B sees what A did meanwhile.
8. **Finish (15 seconds).** **Share > Download** a PDF or an image, or **Save project file**. *Point out:* more than 7,000 tests, a documented threat model and a roadmap ([`docs/VERIFICATION.md`](VERIFICATION.md), [`ROADMAP.md`](ROADMAP.md)).

## What to say when asked

- *Is it only for diagrams?* No: it is a page-based design editor (presentations, social posts, documents) with diagram tools; the live editing works on every design.
- *Where is the data?* In each person's browser, and for a shared design also on the server that you run (one file per room). The links are passwords.
- *What does it cost to run?* The editor is a static site. The live server is one small Node process; it needs memory for the rooms that are open and a folder for the files.
- *Is it safe to open a link that somebody sends?* A link names a server, and the browser checks everything that server says in the way the server checks the browser: a design with code in it is refused with a sentence and nothing of it is kept, and a server that turns bad in the middle is left at once. The worst a server you do not trust can do is show you a design of its choice and see what you type into it. [`SECURITY.md`](../SECURITY.md) has the list.
- *What is missing?* Pictures are not shared yet (a picture that one person adds does not reach the others), no cursors or names, no comments, no accounts, links do not expire. The list with the order is in [`COLLABORATION.md`](COLLABORATION.md).

## If something does not work

- The **Start live session** button says it could not reach the server: the server is not running, or the address is wrong (`http://localhost:8787`); the editor must be served from `localhost` or `127.0.0.1` for `http://` addresses (a page on `https://` needs an `https://` server).
- The second window opens the home page, not the design: the link was cut when it was copied. Copy it again from **Share > Work together** (the field selects itself when you click it).
- After a code change, restart `npm run dev`: a dev server that has run while sources changed can load the editor twice.
