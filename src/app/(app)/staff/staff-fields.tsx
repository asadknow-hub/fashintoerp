import { Field } from "@/components/ui";
import { givable, type Role, roleLabel } from "@/lib/roles";

// The fields shared by the "add" and "edit" staff forms.
export function StaffFields({
  staff,
  self = false,
  mine,
}: {
  staff?: { name: string; email: string; role: Role; active: boolean };
  self?: boolean;
  // The role of whoever is filling this in: it decides which roles they can give.
  mine: Role;
}) {
  const editing = !!staff;
  const choices = givable(mine);
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <input name="name" required defaultValue={staff?.name} className="input" />
        </Field>
        <Field label="Email" hint="They sign in with this.">
          <input
            name="email"
            type="email"
            required
            defaultValue={staff?.email}
            className="input"
          />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Role"
          hint={
            self
              ? "You can't change your own role."
              : mine === "admin"
                ? "An Owner is a partner: they manage staff and settings, and can edit or delete any order. They can't change your account or another Owner's."
                : "Only the System Admin can add an Owner."
          }
        >
          {self || choices.length < 2 ? (
            <>
              <input type="hidden" name="role" value={self && staff ? staff.role : "staff"} />
              <input
                value={roleLabel[self && staff ? staff.role : "staff"]}
                disabled
                className="input bg-stone-100"
              />
            </>
          ) : (
            <select name="role" defaultValue={staff?.role ?? "staff"} className="input">
              {choices.map((role) => (
                <option key={role} value={role}>
                  {roleLabel[role]}
                </option>
              ))}
            </select>
          )}
        </Field>
        {self ? (
          <Field label="Password" hint="Change your own password in Settings.">
            <input value="••••••••" disabled className="input bg-stone-100" />
          </Field>
        ) : (
          <Field
            label={editing ? "New password" : "Password"}
            hint={
              editing
                ? "Leave empty to keep the current one."
                : "At least 8 characters. Share it with them."
            }
          >
            <input
              name="password"
              type="text"
              autoComplete="off"
              required={!editing}
              minLength={8}
              className="input"
            />
          </Field>
        )}
      </div>
      {editing &&
        (self ? (
          <input type="hidden" name="active" value="on" />
        ) : (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="active"
              defaultChecked={staff.active}
              className="size-4 accent-brand"
            />
            Can sign in
          </label>
        ))}
    </>
  );
}
