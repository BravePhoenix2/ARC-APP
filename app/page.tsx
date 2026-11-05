import TrendingDrops from "@/components/TrendingDrops";
import DailyMuse from "@/components/DailyMuse";
import Image from "next/image";
import { arcChain } from "@/lib/arcConfig";
import Atmosphere from "@/components/Atmosphere";
import Link from "next/link";
import ArticLogo from "@/components/ArticLogo";
import Eyebrow from "@/components/Eyebrow";
import { LaunchAppButton } from "@/components/AppEntry";
import TestnetNotice from "@/components/TestnetNotice";
import { OrbitCircle, OrbitOval, OrbitSquare, OrbitTriangle } from "@/components/orbit-shapes";

const FEATURES = [
  {
    title: "USDC gas fees",
    description: "Every transaction is priced and paid in USDC — no need to hold a separate gas token.",
    Icon: OrbitCircle,
    color: "#7C74C4",
  },
  {
    title: "No volatile gas costs",
    description: "Fees stay predictable and stable, so you always know what a mint or trade will cost.",
    Icon: OrbitSquare,
    color: "#EF476F",
  },
  {
    title: "Mint NFTs instantly",
    description: "Sub-second finality on Arc means your mint confirms almost the moment you click.",
    Icon: OrbitTriangle,
    color: "#362A67",
  },
  {
    title: "Test art checkout too",
    description: "Try an original-art purchase and delivery form with test USDC and fictional delivery details.",
    Icon: OrbitOval,
    color: "#F49BC5",
  },
] as const;

const HOW_IT_WORKS = [
  {
    step: "01",
    title: "Connect your wallet",
    description: "Link a wallet on Arc — no separate gas token to buy first, USDC covers everything.",
  },
  {
    step: "02",
    title: "Browse or mint",
    description: "Explore reviewed Testnet drops, or submit your own collection for approval.",
  },
  {
    step: "03",
    title: "Pay in USDC",
    description: "Try mints, bids, and purchases with faucet USDC. Test tokens have no monetary value.",
  },
  {
    step: "04",
    title: "Check the result",
    description: "Confirm your Testnet NFT in your wallet and report any issue. Delivery flows are simulations during this phase.",
  },
] as const;

const FLOW_STEPS = [
  { step: "01", status: "DRAFT", statusBg: "#C9C7CD", statusText: "#362A67", title: "Collection created" },
  { step: "02", status: "UPCOMING", statusBg: "#F49BC5", statusText: "#362A67", title: "Countdown live" },
  { step: "03", status: "LIVE", statusBg: "#2FE6A6", statusText: "#0B3B2E", title: "Minting open" },
  { step: "04", status: "MINTED OUT", statusBg: "#362A67", statusText: "#FFFFFF", title: "Supply gone" },
  { step: "05", status: "LISTED", statusBg: "#7C74C4", statusText: "#FFFFFF", title: "Secondary market" },
  { step: "06", status: "SETTLED", statusBg: "#EF476F", statusText: "#FFFFFF", title: "USDC, on-chain" },
] as const;

const FLOW_STATS = [
  { label: "COLLECTIONS LIVE", value: "—" },
  { label: "ITEMS MINTED", value: "—" },
  { label: "VOLUME SETTLED", value: "—" },
] as const;

const sectionHeading = "text-2xl font-extrabold uppercase tracking-[-0.01em] text-[var(--page-text)] sm:text-3xl lg:text-4xl";

export default function Home() {
  return (
    <main className="gallery-page min-h-screen w-full text-[var(--page-text)]">
      <Atmosphere />
      <TestnetNotice />
      <div className="grid lg:min-h-screen lg:grid-cols-2">
        <div className="hero-copy relative flex min-h-[420px] flex-col px-6 py-6 sm:px-10 lg:px-16 xl:px-20">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <ArticLogo className="text-xl sm:text-2xl" />
          </header>

          <div className="flex flex-1 flex-col justify-center py-10 lg:py-14">
            <Eyebrow className="text-[var(--faint-text)]">{`Built on ${arcChain.name}`}</Eyebrow>

            <h1 className="max-w-[600px] text-[2.6rem] font-bold leading-[1.05] tracking-[-0.02em] text-[var(--page-text)] sm:text-[3.4rem] md:text-[4rem] lg:text-[3.4rem] xl:text-[4.2rem]">
              Every piece of
              <br />
              <span className="hero-word">Art</span> is worth its price
            </h1>

            <p className="mt-5 max-w-[430px] text-sm font-medium leading-7 text-[var(--muted-text)] sm:text-base lg:text-lg">
              A USDC-native art marketplace driven by creators, craft, clarity, and community.
            </p>

            <div className="mt-7 flex flex-wrap items-start gap-x-5 gap-y-3 lg:mt-8">
              <LaunchAppButton />
              <Link href="/apply" className="inline-flex py-3 text-sm font-semibold text-[var(--muted-text)] underline decoration-[#b55fbe]/50 underline-offset-4">Are you a creator? Apply ↗</Link>
            </div>
            <div className="mt-7 flex flex-wrap gap-5 text-[10px] font-semibold uppercase tracking-[.15em] text-[var(--faint-text)]">
              <span className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-[#20b88a]" /> Built on Arc</span>
              <span>Digital & physical art</span>
            </div>
          </div>

          <a
            href="#works"
            className="absolute bottom-6 left-1/2 hidden -translate-x-1/2 flex-col items-center gap-2 text-xs font-medium uppercase tracking-[0.2em] text-[var(--faint-text)] transition hover:text-[var(--page-text)] lg:flex"
          >
            <span>Scroll to explore</span>
            <span className="flex h-9 w-6 items-start justify-center rounded-full border-2 border-[var(--border-soft)] p-1">
              <span className="h-1.5 w-1.5 animate-scroll-wheel rounded-full bg-[#EF476F]" />
            </span>
          </a>
        </div>

        <div className="hero-stage relative flex min-h-[480px] items-stretch justify-center overflow-hidden">
          <div className="hero-frame">
          <Image
            src="/fff.png"
            alt="Illustration of a hand pinching a pencil, framed by a staircase, a cylinder, and concentric circles"
            fill
            sizes="(min-width: 1024px) 50vw, 100vw"
            className="animate-fade-slide-in object-cover"
            priority
          />
          </div>
          <div className="art-caption">
            <span className="art-caption-icon" aria-hidden="true">✳</span>
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-[.2em] text-[var(--faint-text)]">The Artiq perspective</p>
              <p className="mt-1 text-sm font-semibold text-[var(--page-text)]">A space for the extraordinary.</p>
            </div>
          </div>
        </div>
      </div>

      <div className="px-6 sm:px-10 lg:px-16 xl:px-20"><DailyMuse /></div>

      <section id="works" className="border-t border-[var(--border-soft)] px-6 py-16 sm:px-10 sm:py-20 lg:px-16 lg:py-24 xl:px-20">
        <div>
          <Eyebrow className="text-[var(--faint-text)]">Why Artic</Eyebrow>
          <h2 className={sectionHeading}>Built different.</h2>
          <p className="mt-3 max-w-[520px] text-sm leading-7 text-[var(--muted-text)] sm:text-base">
            Built on Arc from the ground up, so every part of buying and selling art feels instant and predictable.
          </p>

          <div className="mt-10 grid gap-x-8 gap-y-10 border-t border-[var(--border-soft)] pt-10 sm:grid-cols-2 lg:mt-14 lg:grid-cols-4 lg:pt-14">
            {FEATURES.map((feature) => (
              <div key={feature.title} className="gallery-feature">
                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--chip-bg)]">
                  <feature.Icon width={22} height={22} color={feature.color} />
                </span>
                <h3 className="mt-4 text-base font-bold text-[var(--page-text)] sm:text-lg">{feature.title}</h3>
                <p className="mt-2 text-sm leading-6 text-[var(--muted-text)]">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="gallery-section border-t border-[var(--border-soft)] bg-[var(--section-alt-bg)] px-6 py-16 sm:px-10 sm:py-20 lg:px-16 lg:py-24 xl:px-20">
        <div>
          <Eyebrow className="text-[var(--faint-text)]">How it works</Eyebrow>
          <h2 className={sectionHeading}>Four steps. Start to finish.</h2>
          <p className="mt-3 max-w-[520px] text-sm leading-7 text-[var(--muted-text)] sm:text-base">
            From connecting a wallet to owning the piece — nothing hidden in between.
          </p>

          <div className="mt-10 grid gap-x-8 gap-y-10 border-t border-[var(--border-soft)] pt-10 sm:grid-cols-2 lg:mt-14 lg:grid-cols-4 lg:pt-14">
            {HOW_IT_WORKS.map((item) => (
              <div key={item.step}>
                <span className="font-mono text-sm font-bold tracking-[0.1em] text-[#EF476F]">[{item.step}]</span>
                <h3 className="mt-3 text-base font-bold text-[var(--page-text)] sm:text-lg">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-[var(--muted-text)]">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="gallery-flow border-t border-[var(--border-soft)] bg-[var(--flow-bg)] px-6 py-16 text-[#362A67] sm:px-10 sm:py-20 lg:px-16 lg:py-24 xl:px-20">
        <div>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <Eyebrow className="text-[#362A67]/70" dotColor="#362A67">
                Flow
              </Eyebrow>
              <h2 className="text-2xl font-extrabold uppercase tracking-[-0.01em] text-[#362A67] sm:text-3xl lg:text-4xl">
                A drop, start to finish.
              </h2>
            </div>
            <span className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.15em] text-[#362A67]/70">
              <span className="h-1.5 w-1.5 rounded-full bg-[#362A67]" />
              Built on {arcChain.name}
            </span>
          </div>

          <div className="mt-10 overflow-x-auto lg:mt-14">
            <div className="flex min-w-[900px] gap-8 border-t border-[#362A67]/20 pt-10 lg:pt-14">
              {FLOW_STEPS.map((item, i) => (
                <div key={item.step} className="relative flex-1">
                  {i > 0 && <span className="absolute -left-4 top-3 h-1.5 w-1.5 rounded-full bg-[#362A67]/25" />}
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-[#362A67]/60">[{item.step}]</span>
                    <span
                      className="rounded px-2 py-0.5 font-mono text-[11px] font-semibold tracking-[0.05em]"
                      style={{ backgroundColor: item.statusBg, color: item.statusText }}
                    >
                      {item.status}
                    </span>
                  </div>
                  <p className="mt-3 text-sm font-semibold text-[#362A67]">{item.title}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-10 grid grid-cols-1 gap-8 border-t border-[#362A67]/20 pt-8 sm:grid-cols-3 lg:mt-12">
            {FLOW_STATS.map((stat) => (
              <div key={stat.label}>
                <p className="font-mono text-xs uppercase tracking-[0.15em] text-[#362A67]/60">[:{stat.label}]</p>
                <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-[#362A67]">{stat.value}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--border-soft)] px-6 py-16 sm:px-10 sm:py-20 lg:px-16 lg:py-24 xl:px-20">
        <div>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <Eyebrow className="text-[var(--faint-text)]">Trending</Eyebrow>
              <h2 className={sectionHeading}>Trending drops</h2>
              <p className="mt-3 text-sm text-[var(--muted-text)]">The newest published NFT collections, updated every hour.</p>
            </div>
            <Link href="/nfts" className="text-sm font-semibold text-[#EF476F] hover:text-[#d73c63] sm:text-base">
              View all ↗
            </Link>
          </div>

          <TrendingDrops />
        </div>
      </section>

      <footer id="contact" className="px-6 py-8 sm:px-10 sm:py-10 lg:px-16 xl:px-20">
        <div className="gallery-footer rounded-2xl bg-[var(--section-alt-bg)] px-6 py-8 shadow-[var(--card-shadow)] sm:px-10 sm:py-10">
          <div className="flex flex-col gap-8 sm:flex-row sm:items-center sm:justify-between">
            <ArticLogo className="text-lg" />

            <div className="space-y-3 text-sm text-[var(--faint-text)]"><Link href="/testnet" className="underline underline-offset-4">Testnet guide, privacy & support</Link><p>© {new Date().getFullYear()} Artic. Built on Arc.</p></div>
          </div>
        </div>
      </footer>

      <div className="flex justify-center px-6 py-16 sm:py-20">
        <ArticLogo className="text-4xl sm:text-6xl lg:text-8xl" />
      </div>
    </main>
  );
}
