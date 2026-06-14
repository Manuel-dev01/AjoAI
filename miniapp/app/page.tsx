import Link from "next/link";
import { RingMark } from "@/components/RingMark";

export default function Landing() {
  return (
    <>
      {/* NAV */}
      <nav className="nav">
        <div className="wrap">
          <div className="brand">
            <RingMark variant="static" />
            Ajo<span className="ai">AI</span>
          </div>
          <div className="nav-links">
            <a href="#how">How it works</a>
            <a href="#circle">The circle</a>
            <a href="#voices">Voices</a>
            <a href="#app">In MiniPay</a>
            <a href="#faq">FAQ</a>
          </div>
          <Link href="/app" className="btn btn-ochre">Open in MiniPay</Link>
        </div>
      </nav>

      {/* HERO */}
      <header className="hero">
        <RingMark variant="full" className="giantring" />
        <div className="wrap">
          <div className="hero-inner">
            <span className="tagpill">
              <svg width="16" height="16" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="40" fill="none" stroke="#E0A52F" strokeWidth="8" />
                <circle cx="50" cy="10" r="10" fill="#E0A52F" />
              </svg>
              Ajo · Esusu · Chama · Stokvel
            </span>
            <h1>Save like<br />your village<br />always has.<br /><span className="u">Now it&rsquo;s</span><br /><span className="u">unstoppable.</span></h1>
            <p className="sub">A rotating savings circle, run by an agent that can&rsquo;t be bribed, can&rsquo;t forget, and never skips your turn.</p>
            <div className="hero-cta">
              <Link href="/app" className="btn btn-ochre">Open in MiniPay →</Link>
              <a href="#how" className="btn btn-cream">See how it works</a>
            </div>
          </div>
        </div>
        <div className="hero-strip"><div className="wrap">
          <div className="hs"><div className="n">0%</div><div className="l">skimmed from your pot, ever</div></div>
          <div className="hs"><div className="n">8</div><div className="l">neighbours, one circle, one agent</div></div>
          <div className="hs"><div className="n">100%</div><div className="l">on-time payouts, on-chain</div></div>
          <div className="hs"><div className="n">2</div><div className="l">local stablecoins: NGNm &amp; USDm</div></div>
        </div></div>
      </header>

      {/* HOW */}
      <section className="block how" id="how"><div className="wrap">
        <span className="kick">How the circle turns</span>
        <h2 className="h2">Three moves.<br />Zero treasurer.</h2>
        <p className="lede">The job an honest circle organiser does, collecting, paying, remembering, handed to an agent that does it perfectly, every round.</p>
        <div className="steps">
          <div className="step"><div className="si">01</div><h3>Gather your people</h3><p>Join by phone number. Agree the amount and the order. No bank account, no paperwork, no app store.</p></div>
          <div className="step"><div className="si">02</div><h3>The agent collects</h3><p>Every round it pulls each contribution in your own stablecoin, NGNm or USDm, automatically if you allow it.</p></div>
          <div className="step"><div className="si">03</div><h3>Someone gets paid</h3><p>The full pot goes to whoever&rsquo;s turn it is, the same day, with nothing taken out. Then the seat moves on.</p></div>
        </div>
      </div></section>

      {/* CIRCLE */}
      <section className="block circle-b" id="circle"><div className="wrap"><div className="circle-grid">
        <div className="circle-art">
          <RingMark variant="full" />
          <span className="cname active" style={{ top: "1%", left: "50%", transform: "translateX(-50%)" }}>Chidi · their turn</span>
          <span className="cname" style={{ top: "19%", right: "-3%" }}>Ngozi</span>
          <span className="cname" style={{ top: "50%", right: "-7%", transform: "translateY(-50%)" }}>Amara</span>
          <span className="cname" style={{ bottom: "17%", right: "-2%" }}>Fatima</span>
          <span className="cname" style={{ bottom: "-2%", left: "50%", transform: "translateX(-50%)" }}>You</span>
          <span className="cname" style={{ bottom: "17%", left: "-2%" }}>Kwame</span>
          <span className="cname" style={{ top: "50%", left: "-7%", transform: "translateY(-50%)" }}>Aïsha</span>
          <span className="cname" style={{ top: "19%", left: "-3%" }}>Tunde</span>
        </div>
        <div>
          <span className="kick">The shape of trust</span>
          <h2 className="h2">Everybody&rsquo;s in.<br /><span className="u">Everybody&rsquo;s seen.</span></h2>
          <ul className="feat">
            <li><span className="fn">01</span><span><b>Open ledger.</b> Every contribution and payout is visible to the whole circle, live. No secret books.</span></li>
            <li><span className="fn">02</span><span><b>Defaults, handled.</b> A late round is covered from deposits and settled later. Nobody chases anybody.</span></li>
            <li><span className="fn">03</span><span><b>Idle money rests safe.</b> Funds between rounds are parked, never gambled, always there for the next payout.</span></li>
            <li><span className="fn">04</span><span><b>Your turn is sacred.</b> The order is locked when the circle starts. The agent will not move it for anyone.</span></li>
          </ul>
        </div>
      </div></div></section>

      {/* VOICES */}
      <section className="block voices" id="voices"><div className="wrap">
        <span className="kick">Voices from the circle</span>
        <p className="bigquote">&ldquo;If you want to go fast, go alone. If you want to go far, <span className="u">go together.</span>&rdquo;</p>
        <p className="bigquote-by">the proverb AjoAI is built on</p>
        <div className="vcards">
          <div className="vcard">
            <p className="q">&ldquo;Our market ajo used to live in a notebook one woman carried everywhere. Now nobody argues about who paid. It&rsquo;s just there, for everyone to see.&rdquo;</p>
            <div className="who"><span className="av" style={{ background: "var(--green)" }}>A</span><div><div className="nm">Amara O.</div><div className="role">Trader · Lagos</div></div></div>
          </div>
          <div className="vcard">
            <p className="q">&ldquo;I joined three circles in a year and never missed a turn. When I asked for a phone loan, my Trust Score did the talking for me.&rdquo;</p>
            <div className="who"><span className="av" style={{ background: "var(--clay)" }}>K</span><div><div className="nm">Kwame B.</div><div className="role">Boda rider · Nairobi</div></div></div>
          </div>
          <div className="vcard">
            <p className="q">&ldquo;We back savings groups in three countries. AjoAI gives us something we never had: a clean, honest record of who actually saves.&rdquo;</p>
            <div className="who"><span className="av" style={{ background: "var(--ochre-d)" }}>N</span><div><div className="nm">Nadia R.</div><div className="role">Partner · financial-inclusion NGO</div></div></div>
          </div>
        </div>
      </div></section>

      {/* IN MINIPAY */}
      <section className="block app-b" id="app"><div className="wrap">
        <span className="kick">In your hand · inside MiniPay</span>
        <h2 className="h2">Big buttons.<br />Plain words.<br />Real money.</h2>
        <p className="lede">No seed phrases, no gas in CELO, no jargon. Just your circle, in the currency and language you already use.</p>
        <div className="phones">
          {/* dashboard */}
          <div className="phone"><div className="pscreen">
            <div className="pstat"><span>9:41</span><span><i></i><i style={{ width: 10 }}></i></span></div>
            <div className="pbar"><span className="bk">‹</span><span className="tt">Lagos Market Traders</span><span className="mini">MiniApp</span></div>
            <div className="pbody">
              <div className="dash-top"><RingMark variant="full" /><div className="rnd">Round 3 of 8</div><div className="nx">Next payout Monday · Chidi</div></div>
              <div className="mrow"><span className="av" style={{ background: "var(--green)", width: 28, height: 28 }}>A</span><span className="nm">Amara</span><span className="pill paid">Paid</span></div>
              <div className="mrow"><span className="av" style={{ background: "var(--clay)", width: 28, height: 28 }}>C</span><span className="nm">Chidi</span><span className="pill turn">Their turn</span></div>
              <div className="mrow"><span className="av" style={{ background: "var(--green)", width: 28, height: 28 }}>N</span><span className="nm">Ngozi</span><span className="pill paid">Paid</span></div>
              <div className="mrow"><span className="av" style={{ background: "var(--ochre-d)", width: 28, height: 28 }}>F</span><span className="nm">Fatima</span><span className="pill due">Due Fri</span></div>
            </div>
          </div></div>
          {/* your turn */}
          <div className="phone"><div className="pscreen">
            <div className="celebrate">
              <RingMark variant="static" />
              <div className="big">It&rsquo;s your turn!</div>
              <div className="amt"><small>NGNm</small>80,000</div>
              <div className="sm">Just landed in your MiniPay. Eight neighbours made it happen.</div>
              <div className="pv">Go far, together.</div>
            </div>
          </div></div>
          {/* contribute */}
          <div className="phone"><div className="pscreen">
            <div className="pstat"><span>9:41</span><span><i></i><i style={{ width: 10 }}></i></span></div>
            <div className="pbar"><span className="bk">‹</span><span className="tt">Round 3</span></div>
            <div className="pbody">
              <div className="heading">Your circle is counting on you</div>
              <div className="subt">Due Friday · auto-collected if you allow it</div>
              <div className="contrib"><div className="a"><small>NGNm</small>10,000</div><div className="l">Your contribution</div></div>
              <div className="lrow"><span>From</span><span className="v">MiniPay · NGNm</span></div>
              <div className="lrow"><span>Balance after</span><span className="v">NGNm 24,300</span></div>
              <div className="lrow"><span>Goes to</span><span className="v" style={{ color: "var(--clay-d)" }}>Chidi&rsquo;s payout</span></div>
            </div>
          </div></div>
        </div>
        <Link className="btn btn-ink app-link" href="/app">See the full app →</Link>
      </div></section>

      {/* FAQ */}
      <section className="block faq" id="faq"><div className="wrap">
        <span className="kick">Common questions</span>
        <h2 className="h2">The honest answers.</h2>
        <div className="faq-grid">
          <div className="faq-item"><h4><span className="qn">Q1</span>Do I need a bank account or crypto?</h4><p>No. You join with your phone number inside MiniPay and save in a local stablecoin, NGNm or USDm. No bank, no seed phrase, and gas is paid in stablecoin.</p></div>
          <div className="faq-item"><h4><span className="qn">Q2</span>What if someone doesn&rsquo;t pay their round?</h4><p>Each member posts a one-round security deposit. If someone misses, that deposit covers the round so the payout still ships in full, on time. Nobody has to chase anybody.</p></div>
          <div className="faq-item"><h4><span className="qn">Q3</span>Who decides the payout order?</h4><p>The circle does, when it starts. Once locked, the order can&rsquo;t be changed by anyone, including us. Your turn is guaranteed.</p></div>
          <div className="faq-item"><h4><span className="qn">Q4</span>What is a Trust Score, and is it mine?</h4><p>It&rsquo;s a portable savings-credit score (ERC-8004) you build by finishing circles on time. It travels with you to lenders, landlords and bigger circles.</p></div>
          <div className="faq-item"><h4><span className="qn">Q5</span>Where does my money sit between rounds?</h4><p>Idle contributions are parked in safe reserves, never lent out or gambled. They&rsquo;re always there for the next payout.</p></div>
          <div className="faq-item"><h4><span className="qn">Q6</span>What does AjoAI cost?</h4><p>Nothing is skimmed from your pot. You get out exactly what the circle puts in, the full amount, every turn.</p></div>
        </div>
      </div></section>

      {/* FOOTER CTA */}
      <section className="fcta"><div className="wrap">
        <RingMark variant="full" />
        <h2>Start your <span className="u">ajo</span> today.</h2>
        <p>In the language, the currency, and the company you already trust.</p>
        <Link href="/app" className="btn btn-ochre">Open in MiniPay →</Link>
      </div></section>

      {/* SITE FOOTER */}
      <footer className="site-footer"><div className="wrap">
        <div className="sf-top">
          <div>
            <div className="sf-brand"><RingMark variant="static" />Ajo<span className="ai">AI</span></div>
            <p className="sf-blurb">The savings circle your community already trusts, run by an agent that never forgets a contribution or skips a turn.</p>
            <div style={{ marginTop: 22 }}><Link href="/app" className="btn btn-ochre">Open in MiniPay →</Link></div>
          </div>
          <div className="sf-col"><h5>Product</h5><a href="#how">How it works</a><a href="#circle">The circle</a><a href="#app">In MiniPay</a><Link href="/app">App screens</Link></div>
          <div className="sf-col"><h5>Learn</h5><a href="#voices">Voices</a><a href="#faq">FAQ</a><Link href="/app/score">Trust Score</Link><a href="#">Stablecoins</a></div>
          <div className="sf-col"><h5>Company</h5><a href="#">About</a><a href="#">Partners &amp; NGOs</a><a href="#">Careers</a><a href="#">Contact</a></div>
        </div>
        <div className="sf-bottom">
          <span>© 2026 AjoAI · Built for MiniPay on Celo</span>
          <span>Ajo · Esusu · Chama · Stokvel: one idea, every name</span>
        </div>
      </div></footer>
    </>
  );
}
