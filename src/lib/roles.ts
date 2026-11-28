// The three kinds of account, from the top down:
//   admin – the System Admin: the one top account, set up first.
//   owner – an Owner: a partner. Runs the business like the System Admin
//           does, but can't touch the System Admin's or another Owner's account.
//   staff – Staff: takes and moves orders.
export const roles = ["admin", "owner", "staff"] as const;
export type Role = (typeof roles)[number];

export const roleLabel = { admin: "System Admin", owner: "Owner", staff: "Staff" } as const;

// Owners and the System Admin run the business: settings, staff, the
// activity log, editing and deleting orders.
export const manages = (role: Role) => role !== "staff";

// Whose account someone may edit or delete: only the ones below them.
export const canManage = (me: Role, them: Role) =>
  me === "admin" ? them !== "admin" : me === "owner" && them === "staff";

// The roles someone may give to an account they add or edit.
export const givable = (me: Role): Role[] =>
  me === "admin" ? ["staff", "owner"] : me === "owner" ? ["staff"] : [];
