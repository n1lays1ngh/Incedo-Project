import { Link } from 'react-router-dom'
import { Wordmark, homeFor, useSession } from '../ui'

/*
  Public landing page. Every figure here matches the seeded products and the API's validation rules:
  loan rate 10.50% p.a., ₹10,000 to ₹50,00,000, 6 to 360 months, documents up to 5 MB, links valid 5 minutes.
  The example EMI is computed with the same formula the API uses (₹5,00,000, 36 months, 10.50%).
*/

const LOAN_RATE = '10.50'

export function LandingPage() {
  const session = useSession()
  const dashboard = session ? homeFor(session.role) : null

  return (
    <div className="site">
      <div className="notice"><b>Demonstration project.</b> All accounts and data are synthetic. Do not enter real PAN, Aadhaar or documents.</div>

      <header className="site-head">
        <div className="wrap">
          <Wordmark />
          <nav aria-label="Sections">
            <a href="#products">Products</a>
            <a href="#how">How it works</a>
            <a href="#safeguards">Safeguards</a>
          </nav>
          <div className="actions">
            {dashboard ? (
              <Link className="button" to={dashboard}>Go to your dashboard</Link>
            ) : (
              <>
                <Link className="button ghost" to="/login">Sign in</Link>
                <Link className="button" to="/register">Open an account</Link>
              </>
            )}
          </div>
        </div>
      </header>

      <section className="hero">
        <div className="wrap">
          <div>
            <div className="eyebrow reveal">Savings accounts · Personal loans</div>
            <h1 className="reveal d1">Banking that shows you <em>every step</em> of the decision.</h1>
            <p className="lede reveal d2">
              Open a savings account or apply for a personal loan online. Verify your identity once, see your EMI before you apply,
              and follow your application from submission to decision, with the reason for every change.
            </p>
            <div className="actions reveal d3">
              <Link className="button large" to={dashboard ?? '/register'}>{dashboard ? 'Continue to dashboard' : 'Open an account'}</Link>
              <a className="button large secondary" href="#products">Compare products</a>
            </div>
            <p className="fine reveal d3">Takes about five minutes. You'll need an email address and your PAN, Aadhaar and an address proof.</p>
          </div>

          <figure className="reveal d2" style={{ margin: 0 }}>
            <div className="specimen" aria-label="Example loan application">
              <header>
                <span className="eyebrow">Personal loan · Example</span>
                <span className="ref">REF 7F3A-21C9</span>
              </header>
              <div className="body">
                <dl className="facts">
                  <dt>Amount</dt><dd>₹5,00,000.00</dd>
                  <dt>Tenure</dt><dd>36 months</dd>
                  <dt>Interest rate</dt><dd>{LOAN_RATE}% p.a.</dd>
                  <dt>EMI to income</dt><dd>19.1%</dd>
                </dl>
              </div>
              <div className="steps">
                <div className="done"><i>01</i>Submitted</div>
                <div className="done"><i>02</i>KYC verified</div>
                <div className="now"><i>03</i>Under review</div>
                <div><i>04</i>Decision</div>
              </div>
              <div className="total">
                <span className="eyebrow">Monthly EMI</span>
                <strong>₹16,251.22</strong>
              </div>
            </div>
            <figcaption className="specimen-caption">Illustrative example. EMI at {LOAN_RATE}% p.a. on a monthly income of ₹85,000.</figcaption>
          </figure>
        </div>
      </section>

      <section className="terms" aria-label="Key terms">
        <div className="wrap">
          <div><span>Personal loan rate</span><strong>{LOAN_RATE}%</strong><span>per annum, fixed for the loan</span></div>
          <div><span>Loan amount</span><strong>₹10K–₹50L</strong><span>₹10,000 to ₹50,00,000</span></div>
          <div><span>Tenure</span><strong>6–360</strong><span>months, chosen by you</span></div>
          <div><span>KYC</span><strong>Once</strong><span>verified documents are reused</span></div>
        </div>
      </section>

      <section className="section" id="products">
        <div className="wrap">
          <div className="section-head">
            <div><span className="eyebrow">Products</span><h2>Two products, explained plainly.</h2></div>
            <p>We offer a savings account and a personal loan. Both use the same profile and KYC, so applying for the second takes a fraction of the time.</p>
          </div>
          <div className="products">
            <article className="product">
              <span className="eyebrow">Savings account</span>
              <h3>A savings account in your name</h3>
              <p>Choose the account type that fits you, add a nominee, and we'll open it once your KYC is verified.</p>
              <dl className="facts">
                <dt>Account types</dt><dd>Regular, Salary, Student</dd>
                <dt>Nominee</dt><dd>Required at opening</dd>
                <dt>Documents</dt><dd>PAN, Aadhaar, address proof</dd>
              </dl>
              <div className="actions"><Link className="button secondary" to={dashboard ? '/app/apply' : '/register'}>Open a savings account</Link></div>
            </article>
            <article className="product">
              <span className="eyebrow">Personal loan</span>
              <h3>A personal loan at {LOAN_RATE}% p.a.</h3>
              <p>See your monthly EMI and how it compares to your income while you fill in the form, before you submit anything.</p>
              <dl className="facts">
                <dt>Amount</dt><dd>₹10,000 – ₹50,00,000</dd>
                <dt>Tenure</dt><dd>6 – 360 months</dd>
                <dt>Documents</dt><dd>KYC and a recent salary slip</dd>
              </dl>
              <div className="actions"><Link className="button secondary" to={dashboard ? '/app/apply?product=LOAN' : '/register'}>Apply for a loan</Link></div>
            </article>
          </div>
        </div>
      </section>

      <section className="section" id="how">
        <div className="wrap">
          <div className="section-head">
            <div><span className="eyebrow">How it works</span><h2>From sign-up to decision.</h2></div>
            <p>A credit officer reviews every application. You can see where yours is at any time, and you'll be notified by email when its status changes.</p>
          </div>
          <ol className="steps-list">
            <li><span className="n">01</span><h3>Create your account</h3><p>Register with your email and confirm it with a one-time code.</p></li>
            <li><span className="n">02</span><h3>Verify your identity</h3><p>Upload your PAN, Aadhaar and address proof once. They're reused for every application.</p></li>
            <li><span className="n">03</span><h3>Apply</h3><p>Choose a product. For a loan, check your EMI and attach a salary slip.</p></li>
            <li><span className="n">04</span><h3>Track the decision</h3><p>Follow each status change, with the officer's reason if anything is needed from you.</p></li>
          </ol>
        </div>
      </section>

      <section className="section" id="safeguards">
        <div className="wrap">
          <div className="section-head">
            <div><span className="eyebrow">Safeguards</span><h2>How we look after your information.</h2></div>
            <p>These protections are built into how the portal works. They apply to every customer and every member of staff.</p>
          </div>
          <div className="safeguards">
            <div><b>Identity numbers</b><p>Your PAN and Aadhaar are encrypted when stored and are only ever shown masked, for example XXXX-XXXX-1234.</p></div>
            <div><b>Documents</b><p>Files are kept in private storage. Each viewing link expires after five minutes.</p></div>
            <div><b>Staff access</b><p>Every time an officer opens one of your documents, it is recorded in an audit log.</p></div>
            <div><b>Your session</b><p>Sign-in sessions are short-lived, and repeated failed sign-ins are blocked for 15 minutes.</p></div>
          </div>
        </div>
      </section>

      <section className="cta-band">
        <div className="wrap">
          <h2>Open your account today. Verify once, and apply whenever you're ready.</h2>
          <div className="actions">
            <Link className="button large" to={dashboard ?? '/register'}>{dashboard ? 'Go to your dashboard' : 'Open an account'}</Link>
            {!dashboard && <Link className="button large secondary" to="/login">Sign in</Link>}
          </div>
        </div>
      </section>

      <footer className="site-foot">
        <div className="wrap">
          <div>
            <Wordmark />
            <p>Bank Portal is a demonstration application built for a training assessment. It is not a bank, does not hold money and does not offer real financial products. All data is synthetic.</p>
          </div>
          <div>
            <h4>Customers</h4>
            <ul>
              <li><Link to="/register">Open an account</Link></li>
              <li><Link to="/login">Sign in</Link></li>
              <li><a href="#products">Products</a></li>
            </ul>
          </div>
          <div>
            <h4>Staff</h4>
            <ul>
              <li><Link to="/login">Staff sign in</Link></li>
              <li><a href="#safeguards">Safeguards</a></li>
            </ul>
          </div>
        </div>
      </footer>
    </div>
  )
}
