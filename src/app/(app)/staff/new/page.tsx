import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { FreshOnVisit } from "@/components/fresh-on-visit";
import { PageHeader } from "@/components/ui";
import { requireOwner } from "@/lib/auth";
import { createStaff } from "../actions";
import { StaffFields } from "../staff-fields";

export default async function NewStaffPage() {
  const me = await requireOwner();
  return (
    <div className="max-w-2xl">
      <PageHeader title="Add staff" />
      <FreshOnVisit>
        <ActionForm action={createStaff} submit="Add staff" className="card space-y-3 p-3">
          <StaffFields mine={me.role} />
        </ActionForm>
      </FreshOnVisit>
      <Link href="/staff" className="mt-4 inline-block text-sm text-stone-600 hover:underline">
        ← Back to staff
      </Link>
    </div>
  );
}
