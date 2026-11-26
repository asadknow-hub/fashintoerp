import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireOwner } from "@/lib/auth";
import { isUuid } from "@/lib/format";
import { deleteStaff, updateStaff } from "../actions";
import { StaffFields } from "../staff-fields";

export default async function EditStaffPage({ params }: PageProps<"/staff/[id]">) {
  const me = await requireOwner();
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const [staff] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      active: users.active,
    })
    .from(users)
    .where(eq(users.id, id));
  if (!staff) notFound();
  const self = staff.id === me.id;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <Link href="/staff" className="text-sm text-stone-500 hover:underline">
          ← Staff
        </Link>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">{staff.name}</h1>
      </div>

      <ActionForm
        action={updateStaff.bind(null, staff.id)}
        submit="Save changes"
        className="card space-y-4 p-6"
      >
        <StaffFields staff={staff} self={self} />
      </ActionForm>

      {!self && (
        <ActionForm
          action={deleteStaff.bind(null, staff.id)}
          submit="Delete staff member"
          submitClassName="btn-secondary text-rose-700"
          confirm={`Delete ${staff.name}? This can't be undone.`}
          className="card space-y-3 p-6"
        >
          <h2 className="text-sm font-semibold">Delete</h2>
          <p className="text-sm text-stone-600">
            Removes their login for good. Orders and stock changes they made
            stay, but will no longer show their name. To only stop them signing
            in, untick “Can sign in” above instead.
          </p>
        </ActionForm>
      )}
    </div>
  );
}
