import { Field } from "@/components/ui";

// The fields shared by the "add" and "edit" staff forms.
export function StaffFields({
  staff,
  self = false,
}: {
  staff?: { name: string; email: string; role: "owner" | "staff"; active: boolean };
  self?: boolean;
}) {
  const editing = !!staff;
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
              : "A System Admin can manage staff and settings, and edit or delete any order."
          }
        >
          {self ? (
            <>
              <input type="hidden" name="role" value="owner" />
              <input value="System Admin" disabled className="input bg-stone-100" />
            </>
          ) : (
            <select name="role" defaultValue={staff?.role ?? "staff"} className="input">
              <option value="staff">Staff</option>
              <option value="owner">System Admin</option>
            </select>
          )}
        </Field>
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
