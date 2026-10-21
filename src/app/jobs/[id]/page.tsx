import { JobView } from "@/components/job-view";

export const dynamic = "force-dynamic";

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="pt-8">
      <JobView id={id} />
    </div>
  );
}
