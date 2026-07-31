export default function Loading() {
  return (
    <main className="route-loading min-h-screen">
      <div className="h-[72px] bg-[#17233f]" />
      <div className="mx-auto max-w-5xl p-4 md:p-8">
        <div className="card grid min-h-48 place-items-center p-8">
          <div className="text-center">
            <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-blue-100 border-t-blue-600" />
            <p className="mt-4 font-bold text-gray-500">画面を読み込んでいます…</p>
          </div>
        </div>
      </div>
    </main>
  );
}
