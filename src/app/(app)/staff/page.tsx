import { asc } from "drizzle-orm";
import Link from "next/link";
import { Badge, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireOwner } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { getPrefs } from "@/lib/settings";

export default async function StaffPage() {
  const me = await requireOwner();
  const { timezone } = await getPrefs();
  const staff = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      active: users.active,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(asc(users.createdAt));

  return (
    <>
      <PageHeader
        title="Staff"
        subtitle="Everyone who can sign in to this system."
        action={{ href: "/staff/new", label: "Add staff" }}
      />
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-stone-200">
            <tr>
              <th className="th">Name</th>
              <th className="th">Email</th>
              <th className="th">Role</th>
              <th className="th">Access</th>
              <th className="th">Added</th>
              <th className="th" />
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {staff.map((person) => (
              <tr key={person.id} className="hover:bg-stone-50">
                <td className="td font-medium">
                  <Link href={`/staff/${person.id}`} className="hover:underline">
                    {person.name}
                  </Link>
                  {person.id === me.id && (
                    <span className="ml-2 text-xs font-normal text-stone-500">(you)</span>
                  )}
                </td>
                <td className="td text-stone-600">{person.email}</td>
                <td className="td">
                  <Badge tone={person.role === "owner" ? "blue" : "gray"}>
                    {person.role === "owner" ? "Owner" : "Staff"}
                  </Badge>
                </td>
                <td className="td">
                  <Badge tone={person.active ? "green" : "red"}>
                    {person.active ? "Can sign in" : "Access off"}
                  </Badge>
                </td>
                <td className="td whitespace-nowrap text-stone-600">
                  {formatDate(person.createdAt, timezone)}
                </td>
                <td className="td text-right">
                  <Link href={`/staff/${person.id}`} className="btn-secondary btn-sm">
                    Edit
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
