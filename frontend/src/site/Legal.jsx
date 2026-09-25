/*
 * Privacy and Terms.
 *
 * These are STRUCTURE, not law. The headings and the plain-English summaries
 * describe what FlowXP actually does with data, which is the part engineering
 * can state truthfully — but the binding text has to come from a lawyer who
 * knows the DPDP Act and your GST obligations, and inventing it here would
 * produce a document that looks authoritative and is not.
 *
 * The banner saying so is deliberate and should be removed by whoever replaces
 * the body copy, not before.
 */
import { Container } from '../components/ui.jsx';

const PRIVACY = [
  ['What we collect',
   'Your name, email, phone and password (hashed, never stored in plain text). For your business: its name, type, address, GSTIN and the records you create — products, customers, invoices, payments and expenses.'],
  ['Why we collect it',
   'To run the product you signed up for: authenticating you, isolating your business from every other business, calculating tax, and producing your reports. We do not sell it and we do not use it to advertise to you.'],
  ['Where it lives',
   'On our servers, tied to your business ID. Every request is checked against what your account is a member of before anything is read.'],
  ['Who can see it',
   'You, the people you invite, and the FlowXP engineers who need access to fix a fault you have reported. Flow AI answers only from the business you are signed in to.'],
  ['How long we keep it',
   'For as long as your account exists. When your trial ends we do not delete anything — your data stays available to read and to export.'],
  ['Your rights',
   'You can export your data, correct it, or ask us to delete your account and everything in it.'],
  ['Contact',
   'support@managerxp.com']
];

const TERMS = [
  ['The service',
   'FlowXP is billing and business management software provided by ManagerXP. It is provided as-is, and we work to keep it available but do not guarantee uninterrupted service.'],
  ['Your account',
   'You are responsible for keeping your password safe and for what the people you invite do with the access you give them.'],
  ['The free trial',
   'Every new business gets 7 days of full access with no credit card. When it ends, billing pauses and your data stays where it is, readable and exportable, until you upgrade.'],
  ['Payment and renewal',
   'Paid plans bill on the cycle you choose. You can upgrade, downgrade or cancel; cancelling stops the next renewal rather than refunding the current period.'],
  ['Your data is yours',
   'You own what you put into FlowXP. We do not sell it, and you can export it at any time.'],
  ['Acceptable use',
   'Do not use FlowXP to break the law, to store someone else’s data without their permission, or to attack the service or other customers.'],
  ['Tax and compliance',
   'FlowXP calculates GST from the details and HSN codes you enter. Getting those right, and filing correctly, remains your responsibility and your accountant’s — we are not making a certification claim.'],
  ['Changes',
   'We will tell you before these terms change in a way that affects you.']
];

const LegalPage = ({ heading, intro, sections }) => (
  <Container className="max-w-3xl py-14 sm:py-16">
    <h1 className="text-3xl font-extrabold tracking-tight text-ink-900 sm:text-4xl">{heading}</h1>
    <p className="mt-4 text-base leading-relaxed text-ink-500">{intro}</p>

    <div className="mt-8 rounded-lg border border-amber-500/40 bg-amber-500/8 px-4 py-3 text-sm text-ink-700">
      <strong className="font-semibold">Draft — not yet legally reviewed.</strong>{' '}
      This page describes how FlowXP actually handles your data, but it is not the
      final binding text. It must be replaced by a reviewed policy before launch.
    </div>

    <dl className="mt-12 space-y-9">
      {sections.map(([title, body]) => (
        <div key={title}>
          <dt className="text-base font-semibold text-ink-900">{title}</dt>
          <dd className="mt-2 text-sm leading-relaxed text-ink-500">{body}</dd>
        </div>
      ))}
    </dl>
  </Container>
);

export const Privacy = () => (
  <LegalPage
    heading="Privacy"
    intro="What FlowXP collects, why, and what we will never do with it."
    sections={PRIVACY}
  />
);

export const Terms = () => (
  <LegalPage
    heading="Terms of service"
    intro="The agreement between your business and ManagerXP for the use of FlowXP."
    sections={TERMS}
  />
);
