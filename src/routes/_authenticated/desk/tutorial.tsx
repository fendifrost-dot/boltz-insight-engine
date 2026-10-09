import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ArrowRight, Play, MessageCircle } from "lucide-react";
import { DeskShell } from "@/components/desk/DeskShell";
import { getTrainingVideo } from "@/lib/desk-tutorial.functions";

export const Route = createFileRoute("/_authenticated/desk/tutorial")({
  head: () => ({ meta: [{ title: "Tutorial · Boltz Automotive" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: DeskTutorial,
});

const lessons = [
  { title: "Open the desk & capture a lead", duration: "1:25", description: "Get started and record a walk-in or phone lead while the details are fresh." },
  { title: "Find a customer & ask Grok", duration: "1:03", description: "Find an existing customer, open their card, and get help from Grok." },
  { title: "Daily habits & owner recap", duration: "1:25", description: "Review the habits that keep customer details useful and the shop on the same page." },
];

function DeskTutorial() {
  const [part, setPart] = useState(1);
  const [playbackError, setPlaybackError] = useState(false);
  const getVideo = useServerFn(getTrainingVideo);
  const video = useQuery({
    queryKey: ["desk-training", part],
    queryFn: () => getVideo({ data: { part } }),
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const lesson = lessons[part - 1]!;
  function selectPart(next: number) {
    setPlaybackError(false);
    setPart(next);
  }
  return (
    <DeskShell>
      <header className="desk-page-heading">
        <div className="desk-eyebrow">LEARN THE SHOP DESK</div>
        <h1>A confident start. In four minutes.</h1>
        <p>Three quick lessons for the counter, the phone, and everything in between. Watch on the shop computer or your iPhone.</p>
      </header>
      <section className="desk-training-player" aria-labelledby="lesson-title">
        <div className="desk-training-screen">
          {video.isPending ? <p role="status">Loading your lesson…</p> : video.isError || playbackError ? (
            <div role="alert"><p>We couldn’t load this video.</p><button className="desk-training-next" onClick={() => { setPlaybackError(false); void video.refetch(); }}>Try again</button></div>
          ) : (
            <video key={`${part}-${video.data.url}`} src={video.data.url} controls playsInline preload="metadata" aria-label={`Part ${part}: ${lesson.title}`} onError={() => setPlaybackError(true)} />
          )}
        </div>
        <div className="desk-training-caption">
          <span className="desk-training-kicker">PART {part} OF 3 · {lesson.duration}</span>
          <h2 id="lesson-title">{lesson.title}</h2>
          <p>{lesson.description}</p>
          {part < 3 ? <button className="desk-training-next" onClick={() => selectPart(part + 1)}>Next lesson <ArrowRight size={17} /></button> : <Link className="desk-training-next" to="/desk">Back to the front desk <ArrowRight size={17} /></Link>}
        </div>
      </section>
      <nav className="desk-training-lessons" aria-label="Training lessons">
        {lessons.map((item, index) => (
          <button key={item.title} className={`desk-training-lesson ${part === index + 1 ? "is-selected" : ""}`} aria-current={part === index + 1 ? "step" : undefined} onClick={() => selectPart(index + 1)}>
            <span className="desk-training-number">{index + 1}</span>
            <span><strong>{item.title}</strong><small>{item.duration} · {part === index + 1 ? "Selected lesson" : "Watch lesson"}</small></span>
            <Play size={17} aria-hidden="true" />
          </button>
        ))}
      </nav>
      <div className="desk-training-help"><MessageCircle size={20} /><p>Have a question while you work? <Link to="/desk/chat">Ask Grok</Link> right here in the desk.</p></div>
    </DeskShell>
  );
}
