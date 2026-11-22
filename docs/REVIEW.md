# Review and approval (first slice, 2026-11-22)

A team's design can be put up for review, approved or sent back with changes requested, by people who may comment but not edit.
This builds on what is there: teams and roles ([ACCOUNTS.md](ACCOUNTS.md)), team designs live in bound rooms joined with a
session, and pinned comment threads ([COLLABORATION.md](COLLABORATION.md), "Comments"). It adds no backend: the review lives in the
design, travels through the room as operations, and is written back to the team's space with the rest of the design.

Status: the four parts below are built in this slice, with the limits named in [Not in this slice](#not-in-this-slice).

## 1. A commenter role, between viewer and editor

| Role | In the team's space (HTTP) | In the design's live room |
| --- | --- | --- |
| owner | everything (members, invites, deleting forever) | edits; deletes anybody's comment or reply (moderation) |
| editor | makes, edits, trashes and restores designs and folders, uploads | edits; requests a review |
| **commenter** | reads and downloads, as a viewer | comments, replies, resolves; approves or requests changes; never edits the design |
| viewer | reads and downloads | looks |

- **On the server** the table stays one table (`can(role, action)` in `src/server/accounts/roles.ts`): `commenter` has `read` and a
  new action `comment`; every role above it has `comment` too. A role is set, and an invite made, with `commenter` like any other.
- **A commenter opens the room.** `POST …/designs/:id/live` makes the bound room for anybody who may `comment`, not only for those
  who may `write`: a review is mostly done when nobody else has the design open, and comments only reach the team through the room.
  While the room is in memory the space refuses writes of the design (`409 live`) as it does for an editor's room, and the room is
  written back, comments and review included, when it leaves memory. A commenter's seat holds the room as an editor's does; a
  viewer's still does not.
- **The room's role** is `edit`, `comment` or `view` (`Role` in `src/collab/protocol.ts`). A `comment` seat may send batches made
  only of comment and review operations; any other operation refuses the whole batch ("this seat may only comment"). Its presence
  carries no selection and no text box, as a viewer's.
- **Sync.** A commenter writes nothing through the space (`writes(role)` in `src/cloud/sync.ts` is owner and editor), so their
  copy is the team's; the editor opens the design in its read-only mode, with the Comment tool, the Comments panel and the review
  buttons still working.
- **Lowering a role** sends the person's sockets away (`denied no-access`, 4003) whenever their room role goes down (edit to
  comment, comment to view), as editor to viewer did, and when an owner is lowered to editor (the room role stays `edit`, but the
  seat no longer deletes others' comments); they join again with the role they now have. A raise sends nobody away (an editor
  made owner deletes others' comments once they join again).

## 2. Comments: the author edits and deletes, an owner moderates

Until now the server did not check who wrote what: a name proves nothing in a room of a link, and the editor only offered Edit and
Delete for the ids it remembered on this device. In a team's room the server knows each seat's account, so it checks.

- **An author has an id** (optional, `CommentAuthor.id`): the account's user id, for a comment or reply written in a team's room.
- **In a bound room** (joined with a session), the server refuses a batch when:
  - a new comment or reply is not in the seat's own name: `author.id` must be the seat's user id and `author.name` the seat's
    account name (the one the room already makes presence use);
  - a change of a comment's or reply's `text`, `editedAt` or `anchor` is not the author's (`author.id` is not the seat's);
  - a deletion of a comment or reply is neither the author's nor an owner's. **Owner moderation** is deletion only: an owner never
    changes somebody else's words.
  - Resolving and reopening (`resolved`) is anybody's who may comment: it is the state of the thread, not somebody's words.
  - A comment or reply **without an id** (written before this slice, or in a room of a link, then shared with the team) can be
    deleted by an owner and edited by nobody in a team's room: its author can no longer prove they wrote it. The CHANGELOG says so.
  - A comment **that comes back with its page** (an undo of a page's deletion brings back the comments that were on it) keeps
    its authors only when the room had that very comment, with the same author and the same authors of the replies it brings, and
    it left the room (`Room.gone`, in memory, the last 5,000). Anything else in the same batch as a `page.add` is a new comment, in
    the seat's own name, so a page cannot carry a comment made up in somebody else's name. After the room left memory such an undo
    is refused as a whole, and kept as a recovery copy like every refused batch.
- **In a room of a link** nothing changes (there is no identity to check), except that an author **with** an id is refused there:
  nobody can pass as an account where accounts are not checked.
- **The editor offers the same rule**: Edit for one's own, Delete for one's own and, for an owner of the team, for everybody's. A
  refused batch is still kept as a recovery copy and said, as every refused batch is.

## 3. Request review, Approve, Request changes: tied to one revision

```ts
interface DesignReview {
  v: 1;                                         // the format of this record
  state: "requested" | "approved" | "changes";
  revision: string;                             // contentRevision() of the design the state is about
  by: CommentAuthor;                            // who set it (with the account's id in a team's room)
  at: number;                                   // epoch ms
}
// Design.review?: DesignReview  (none: no review was asked for)
```

- **One state per design**, the last one set: Request review (owner, editor), Approve and Request changes (owner, editor,
  commenter). Anybody may approve a review they requested in this slice; whether a second person must approve is a policy for later.
- **The revision is the content, not a counter.** `contentRevision(design)` (`src/core/review.ts`) is `"r1-"` and a 106-bit hash of
  the design's width, height and pages written as JSON with sorted keys: what is drawn. The title, unit, guides, comments, the review
  itself and the library's details (folder, star, dates) do not count. A counter would not do: the room's revision moves with every
  comment, is reset when the room is made again from the space, and the space's revision moves when a room only wrote comments back.
  The content's hash is the same on every copy (all copies apply the same operations, `designsEqual` already relies on it), in the
  space, after a reload and on another device.
- **Worked out on the shared copy.** The browser hashes the design as the server has it with this person's unconfirmed edits on
  top (`Session.design`, the store's `contentRevisionNow` through the connection), never the copy in the editor: the editor works
  out the sizes of texts and the lines attached to shapes itself, with the fonts of this device, and never sends them, so two
  devices with different fonts would hash their own copies differently while the server's is one.
- **Out of date.** An approval (or a request, or changes requested) whose `revision` is not the content's revision now is shown as
  being about an earlier version: "Approved an earlier version, edited since". An undo that brings back exactly the approved content
  makes it current again: it is the same content.
- **On the server** a `review.set` is checked against the design as its batch leaves it: its `revision` must be that design's
  `contentRevision`, so an approval is always of what the server holds at that moment; one made while somebody's edit was on its
  way is refused, the browser is told, and the person sees the newer version before they approve again. `by` must be the seat
  (id and name) in a team's room, and carry no id in a room of a link.
- **Shown in the editor** at the top of the Comments panel (`ReviewSection.tsx`): the state, who set it and when (said politely to a
  screen reader as it changes), whether it is about this version, and the buttons the person's role allows; the state the design is
  in already, about this version, is not offered again. A commenter's panel says what they can do and has **Add a comment**, which
  takes the Comment tool (in the read-only mode it places pins and does nothing else). An approval refused by the server is said
  in words ("The design changed just before that reached the server..."), and no recovery copy is made: there is nothing to keep.

## 4. How the server and the live session carry it

- **One new operation**, `review.set { review }`: the whole record, last writer wins (two people approving at once both end with
  one approval, the server's order decides). `diffDesign` makes it when `review` changed, after the comment operations;
  `applyOps` replays it; `checkOps` reads it strictly (`readReview`: every field, no other field, `v` is 1).
- **Negotiated, as comments are.** A browser of this version says `features: ["comments", "review"]` in its join. A server of this
  version answers with the features it shares of those. A browser that did not name `review` gets `view` where it would get
  `comment` (it would refuse a role it does not know), a welcome without `review`, and every batch without `review.set` (it would
  end its session at an operation it does not know). A browser of this version with an older server hides the review and keeps any
  `review.set` out of its batches, as it does comments.
- **Stored with the design** like comments: the room's record, the space's revisions (each revision has the review of its moment,
  which is the history of the review for now), the device's library. `checkDesign` asks `readReview` of a design that arrives whole;
  a project file or a backup reads it kindly (`usableReview`: kept when it is one, left out otherwise).

**The stored schema change** is two optional fields: `Design.review` (whose own `v` lets a later record change shape without a
new design version) and `CommentAuthor.id`. Under [MIGRATIONS.md](MIGRATIONS.md) ("an optional field is added") the design format
version stays 1; both are named in `ADDED` in `persistedShapes.test.ts` and set in `completeDesign()`. A team's record may now hold
the role `commenter`; a server from before this slice does not know it and grants it nothing (`can` fails closed).

**Older clients.** A browser from before this slice that is signed in to an account whose team gave it the role `commenter` cannot
read `GET /api/me` (it knows three roles and refuses the answer) until it is updated; the app updates itself (docs/UPDATES.md).

## Not in this slice

- **A review dashboard**: the designs of a team waiting for review, approved, or with changes requested, across designs. The
  state is in each design and in the space's revisions; a dashboard needs it in the manifest's details (or a feed of its own).
- **Protecting a table's cells from simultaneous edits**: one person at a time types in a text box (COLLABORATION.md); a table's
  cells are one element's value and get no such care yet.
- More than one reviewer, required approvals, an approver who may not be the requester, notifications and mentions.
- A comment role for rooms of a link (a third key beside edit and view).
- A history of review decisions beyond the space's revisions.
- Checks of authorship outside the room: a design `PUT` to the space whole (an editor's offline edit, synced) is not compared
  comment by comment, so an editor's own device could still change somebody's words there. The room is where the rules hold.
- The Comment tool's key `M` in the read-only mode (a commenter uses **Add a comment**), and the review state on the Comments
  button.

## Tests

`src/core/review.test.ts` (the record, the revision of the content, undo), `src/collab/seats.test.ts` (every rule of a seat),
`src/collab/review.sync.test.ts` (a room and browsers by hand: the operation, the commenter, an approval out of date and one refused,
older browsers and servers), `src/server/accounts/review.test.ts` (real sockets: the role, who opens the room, authorship, owner
moderation, an approval refused, roles that go down, writing back), `src/editor/comments/Review.test.tsx` (the panel, the store's
action, the commenter's tool), `src/editor/live/connectionReview.test.ts` and `teamLive.dom.test.ts` (the connection and the team's
room), and `e2e/review.cjs` (an owner and a commenter in Chrome against the real server).
