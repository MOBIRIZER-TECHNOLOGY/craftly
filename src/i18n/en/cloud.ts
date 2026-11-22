import { date, num, plural } from "../format";

/**
 * The words of accounts, teams and sync (src/cloud, src/dashboard/account, docs/ACCOUNTS.md). What the server says is never shown
 * as it is: its refusals come as codes, and each code has words here (`errors`).
 */
export const cloud = {
  /** a refusal of the account server, by its code */
  errors: {
    offline: "The account server could not be reached. Check your connection and try again.",
    "bad-request": "The server could not take that. Check what you typed and try again.",
    "too-big": "That is too big for the server.",
    session: "You were signed out. Sign in again.",
    wrong: "That email and password do not match.",
    forbidden: "Your role in this team does not allow that.",
    origin: "This server does not take requests from this copy of Craftly.",
    "not-found": "It is not there any more.",
    deleted: "It was deleted.",
    method: "The server does not do that.",
    rate: "Too many tries. Wait a while and try again.",
    busy: "The server is busy. Try again in a moment.",
    server: "The server has a problem. Try again later.",
    "signup-closed": "This server is not taking new accounts, or needs an invite or a sign-up code.",
    "code-wrong": "That code is not good, or not any more.",
    "email-taken": "There is an account with this email already. Sign in instead.",
    full: "The server, or this team, is full.",
    newer: "This design is from a newer Craftly than the server knows.",
    conflict: "The design was changed on another device.",
    exists: "There is another design under this id.",
    quota: "The space on the server is full.",
    "last-owner": "A team keeps at least one owner. Make someone else an owner first, or delete the team.",
    "too-many-teams": "You are in as many teams as one may be.",
    "too-many-invites": "This team has as many open invites as it may. Revoke one first.",
    live: "This design is open live with your team right now.",
    "team-full": "This team has as many members as it may. Ask one of its owners to make room.",
    "not-live": "Nobody is editing this design live right now. You can open it from your team's designs.",
    "bad-answer": "The account server sent something Craftly cannot use. Nothing of it was kept.",
    unknown: "Something went wrong. Try again.",
  },

  /** the sync engine (src/cloud/sync.ts) */
  sync: {
    /** the name a picture fetched from the server gets */
    uploadName: "Picture",
    uploadFailed: "A picture could not be fetched from the server. It shows as missing until it can be.",
    newer: "A design on the server is from a newer Craftly. Update Craftly to get it.",
    refused: (title: string) => `“${title}” could not be sent: the server refused it.`,
    full: "Your space on the server is full. Delete designs or uploads you no longer need.",
    /** the title of the copy of a design that was changed on two devices */
    editedOn: (title: string, device: string) => `${title} (edited on ${device || "another device"})`,
    signInAgain: "You were signed out on this device. Sign in again to keep syncing.",
    tooManyConflicts: (n: number) => `Sync stopped after ${num(n)} designs were changed on two devices at once. Check the copies, then sync again.`,
    /** a design of the server whose id a design of another space on this device has */
    sameId: (title: string) => `“${title}” could not be brought to this device: a design of another space here has the same id.`,
  },

  /** what the dashboard and the editor's top bar say */
  status: {
    label: "Sync",
    synced: "Synced",
    syncing: "Syncing…",
    offline: (n: number) => (n ? plural(n, { one: `Offline, ${num(n)} change waiting`, other: `Offline, ${num(n)} changes waiting` }) : "Offline"),
    /** changes that wait because their design is open live on the server: its room writes it back when everybody has left */
    live: (n: number) =>
      plural(n, {
        one: `${num(n)} change waiting: the design is being edited live`,
        other: `${num(n)} changes waiting: their designs are being edited live`,
      }),
    problem: "Sync has a problem",
    syncNow: "Sync now",
    lastSynced: (at: number) => `Last synced ${date(at, { hour: "numeric", minute: "2-digit" })}`,
    details: "Sync details",
  },

  /** the account menu of the dashboard */
  menu: {
    account: "Account",
    signIn: "Sign in",
    createAccount: "Create account",
    settings: "Account settings",
    teamMembers: "Team members",
    signOut: "Sign out",
    signedInAs: (name: string, email: string) => `${name} (${email})`,
  },

  /** the server field, wherever a person may type one */
  server: {
    label: "Account server",
    hint: "The address of the Craftly account server you use, for example accounts.example.org.",
    host: (host: string) => `Server: ${host}`,
    change: "Change server",
    invalid: "That is not the address of a server.",
    none: "No account server is set up for this copy of Craftly. Type the address of one to sign in.",
  },

  signIn: {
    title: "Sign in",
    intro: "Your designs stay on this device. Signing in also keeps them on your account server, so they open on your other devices and with your team.",
    email: "Email",
    password: "Password",
    submit: "Sign in",
    working: "Signing in…",
    noAccount: "No account yet?",
    createOne: "Create one",
    forgot: "Forgot your password?",
    back: "Back to your designs",
    signedIn: (name: string) => `Signed in as ${name}`,
  },

  signUp: {
    title: "Create account",
    name: "Your name",
    email: "Email",
    password: "Password",
    passwordHint: "At least 10 characters. Use a password you use nowhere else: the server receives it.",
    code: "Invite or sign-up code (if you have one)",
    submit: "Create account",
    working: "Creating your account…",
    haveAccount: "Have an account already?",
    signInInstead: "Sign in",
    tooShort: "A password has at least 10 characters.",
  },

  /** the recovery code, shown once after sign-up and after a reset with it */
  recovery: {
    title: "Keep your recovery code",
    body: "With this code you can set a new password yourself if you forget yours. It is shown only now: write it down or keep it in your password manager.",
    code: "Recovery code",
    copy: "Copy code",
    copied: "Recovery code copied",
    kept: "I have kept it",
  },

  reset: {
    title: "Set a new password",
    withCode: "This link lets you set a new password for your account.",
    withRecovery: "Type your email and the recovery code you were given when you made your account.",
    email: "Email",
    recoveryCode: "Recovery code",
    newPassword: "New password",
    submit: "Set new password",
    working: "Setting the password…",
    done: "Your password is set. Sign in with it. Every device was signed out.",
    newRecovery: "Your old recovery code is used up. Here is a new one.",
  },

  invite: {
    title: "Join a team",
    body: "You were invited to a team on Craftly. Its designs open for you on every device you sign in on.",
    server: (host: string) => `The team is on ${host}.`,
    /** signed in to another server than the one the invite is for */
    otherServer: (inviteHost: string, signedInHost: string) =>
      `This invite is for a team on ${inviteHost}, but you are signed in on ${signedInHost}. Sign out first, then open the link again.`,
    join: "Join the team",
    working: "Joining…",
    signInFirst: "Sign in or create an account to join.",
    joined: (team: string) => `You joined ${team}.`,
    notAnInvite: "This link is not an invite. Ask for a new one.",
  },

  account: {
    title: "Account settings",
    name: "Name",
    email: "Email",
    server: "Server",
    devices: "Devices signed in",
    thisDevice: "This device",
    lastUsed: (at: number) => `Last used ${date(at, { day: "numeric", month: "short", year: "numeric" })}`,
    endSession: (device: string) => `Sign out ${device || "that device"}`,
    unknownDevice: "A device",
    password: "Change password",
    oldPassword: "Current password",
    newPassword: "New password",
    changePassword: "Change password",
    passwordChanged: "Your password is changed. Your other devices were signed out.",
    loading: "Loading…",
    close: "Close",
  },

  signOut: {
    title: "Sign out",
    body: "Signing out removes your account's designs from this device. They stay on your account server. Designs that were never moved into your account stay here.",
    waiting: (n: number) =>
      plural(n, {
        one: `${num(n)} change has not reached the server yet. Keep a copy on this device so that nothing is lost.`,
        other: `${num(n)} changes have not reached the server yet. Keep copies on this device so that nothing is lost.`,
      }),
    keep: "Keep copies of my account's designs on this device",
    confirm: "Sign out",
    working: "Signing out…",
    cancel: "Cancel",
    done: "You are signed out.",
    /** designs whose changes could not be sent, kept on this device when the account's designs were removed */
    keptUnsent: (n: number) =>
      plural(n, {
        one: `${num(n)} design had changes that did not reach the server. It was kept on this device as your own.`,
        other: `${num(n)} designs had changes that did not reach the server. They were kept on this device as your own.`,
      }),
  },

  move: {
    title: (n: number) => plural(n, { one: `Move ${num(n)} design into your account?`, other: `Move ${num(n)} designs into your account?` }),
    body: "These designs are on this device only. In your account they open on your other devices too. They also stay here.",
    moveAll: "Move all",
    choose: "Choose",
    notNow: "Not now",
    moveChosen: (n: number) => plural(n, { one: `Move ${num(n)} design`, other: `Move ${num(n)} designs` }),
    chooseLabel: "Designs to move",
    moved: (n: number) => plural(n, { one: `${num(n)} design is moving into your account.`, other: `${num(n)} designs are moving into your account.` }),
    menu: "Move designs into account",
  },

  teams: {
    switcher: "Space",
    yourDesigns: "Your designs",
    team: (name: string) => `Team: ${name}`,
    createTeam: "Create a team",
    teamName: "Team name",
    create: "Create team",
    created: (name: string) => `${name} is made. Invite people from its page.`,
    role: { owner: "Owner", editor: "Editor", commenter: "Commenter", viewer: "Viewer" },
    roleHint: {
      owner: "Manages members, invites and the team",
      editor: "Makes and edits designs and folders",
      commenter: "Comments, reviews and approves designs, without editing them",
      viewer: "Looks and downloads",
    },
  },

  teamPage: {
    title: (name: string) => name,
    members: "Members",
    you: "you",
    roleOf: (name: string) => `Role of ${name}`,
    remove: (name: string) => `Remove ${name}`,
    removeConfirm: (name: string) => `Remove ${name} from the team? They lose the team's designs at once.`,
    leave: "Leave team",
    leaveConfirm: "Leave this team? Its designs stay on this device as your own copies.",
    invites: "Invites",
    noInvites: "No open invites.",
    newInvite: "New invite",
    inviteRole: "Role",
    uses: "Uses",
    hours: "Valid for (hours)",
    makeInvite: "Make invite",
    inviteMade: "Send this link to the people you invite. It is shown only now.",
    inviteLink: "Invite link",
    copyLink: "Copy link",
    copied: "Invite link copied",
    inviteLine: (role: string, uses: number, until: number) =>
      `${role}, ${plural(uses, { one: `${num(uses)} use left`, other: `${num(uses)} uses left` })}, until ${date(until, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}`,
    revoke: "Revoke",
    rename: "Rename team",
    renameLabel: "Team name",
    save: "Save",
    deleteTeam: "Delete team",
    deleteConfirm: (name: string) => `Delete ${name}? Every design, folder and upload of the team is deleted from the server for everybody.`,
    notInTeam: "You are not in this team, or it is gone.",
    loading: "Loading the team…",
    back: "Back to the team's designs",
  },

  /** "Edit live with your team" in the editor's Share panel */
  live: {
    title: "Your team",
    editLive: "Edit live with your team",
    hint: "Members of the team who open this design and press “Edit live with your team” edit it with you, live. No link is needed.",
    viewHint: "You are a viewer in this team: you see the design live and cannot change it.",
    commentHint: "You are a commenter in this team: live, you comment on the design and approve it or ask for changes, and cannot change it.",
    commentLive: "Review live with your team",
    joining: "Joining…",
    joined: "Live with your team",
    viewing: "Viewing live with your team",
    leave: "Stop editing live",
    offline: "Editing live needs the account server. Connect and try again.",
    /** "Edit live" refused: what was edited here could not be sent, and the room starts from the server's copy */
    unsent:
      "Changes made to this design here have not reached the server yet, so it cannot be edited live now. Close it and let it sync (if it was changed on another device too, your changes are kept as a copy), then try again.",
    /** "Edit live" while the team had the design open live and this device had changes the room does not have: they were kept as a copy */
    keptCopy: (title: string) => `Your changes made before joining are kept as “${title}”. You are now editing the team's version live.`,
  },
};
