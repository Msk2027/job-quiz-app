import { StudyApp } from "@/app/page";

export default async function CoursePage({
  params,
}: {
  params: Promise<{ subjectId: string }>;
}) {
  const { subjectId } = await params;
  return (
    <StudyApp
      initialView="subject"
      initialSubjectId={decodeURIComponent(subjectId)}
    />
  );
}
