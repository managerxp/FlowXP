/*
 * The renderer for every marketing page except Home.
 *
 * One component, six pages, driven by the data in content.js. Adding a page is
 * an entry in PAGES and a route — not another file of the same JSX with
 * different words in it.
 */
import { useParams } from 'react-router-dom';
import { Button, Card, Container, Section } from '../components/ui.jsx';
import { PAGES } from './content.js';

const MarketingPage = ({ page }) => {
  const params = useParams();
  const content = PAGES[page ?? params.page];

  /* Only reachable if a route is added without its content. Better than
     rendering an empty page and leaving someone to wonder why. */
  if (!content) {
    return (
      <Section title="Page not found" lead="That page does not exist yet.">
        <div className="text-center"><Button to="/">Back to home</Button></div>
      </Section>
    );
  }

  return (
    <>
      <div className="glow-brand border-b border-line">
        <Container className="py-14 text-center sm:py-16">
          <h1 className="mx-auto max-w-3xl text-4xl font-extrabold tracking-tight text-ink-900 sm:text-5xl">
            {content.title}
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-ink-500">
            {content.lead}
          </p>
          <div className="mt-9">
            <Button to="/signup" size="lg">Start 7-day free trial</Button>
          </div>
        </Container>
      </div>

      {content.sections.map((section, index) => (
        <Section
          key={section.heading || index}
          title={section.heading || undefined}
          className={index % 2 ? 'border-y border-line' : ''}
        >
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {section.items.map((item) => (
              <Card key={item.title}>
                <h3 className="text-base font-semibold text-ink-900">{item.title}</h3>
                <p className="mt-2.5 text-sm leading-relaxed text-ink-500">{item.body}</p>
              </Card>
            ))}
          </div>
        </Section>
      ))}

      <Section>
        <Container>
          <div className="bg-gradient-brand rounded-[--radius-card] px-8 py-12 text-center">
            <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Try it on your own numbers.
            </h2>
            <p className="mx-auto mt-3 max-w-md text-sm text-white/85">
              Seven days free. No credit card required.
            </p>
            <Button to="/signup" variant="secondary" size="lg" className="mt-7">
              Start free trial
            </Button>
          </div>
        </Container>
      </Section>
    </>
  );
};

export default MarketingPage;
