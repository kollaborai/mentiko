# Analytics

privacy-first analytics supporting GA4 and Plausible.

features:
  page view tracking (automatic)
  custom event tracking
  user flow tracking
  custom dimensions
  offline-aware (queues events)

providers:
  ga4       google analytics 4
  plausible self-hosted or cloud
  none      disable tracking

---

## setup

### 1. choose a provider

ga4:
  NEXT_PUBLIC_ANALYTICS_PROVIDER=ga4
  NEXT_PUBLIC_GA4_MEASUREMENT_ID=G-XXXXXXXXXX

plausible:
  NEXT_PUBLIC_ANALYTICS_PROVIDER=plausible
  NEXT_PUBLIC_PLAUSIBLE_DOMAIN=yourdomain.com
  NEXT_PUBLIC_PLAUSIBLE_URL=https://plausible.io/api/event

disable:
  NEXT_PUBLIC_ANALYTICS_PROVIDER=none

### 2. development mode

analytics disabled by default in dev. enable with:

  NEXT_PUBLIC_ANALYTICS_DEBUG=true

---

## automatic tracking

page views tracked automatically on route changes.

nothing needed - the AnalyticsProvider handles it.

---

## manual tracking

### basic event

  import { analytics } from "@/lib/analytics";

  analytics.track({
    name: "button_clicked",
    params: { button: "save", color: "blue" }
  });

### page view

  analytics.pageView("/chains/123", {
    title: "My Chain",
    customDimensions: { namespace: "acme" }
  });

### user flow

  analytics.userFlow({
    flowName: "chain_creation",
    stepName: "select_template",
    stepNumber: 1,
    totalSteps: 5
  });

### set user id

  analytics.setUserId("user-123");

### custom dimension

  analytics.setCustomDimension("namespace", "acme");

---

## react hooks

### useanalytics

  import { useAnalytics } from "@/lib/analytics";

  function MyComponent() {
    const analytics = useAnalytics();
    analytics.track({ name: "thing" });
  }

### useuserflow

  import { useUserFlow } from "@/lib/analytics";

  function CreateChainFlow() {
    const flow = useUserFlow("chain_creation", 5);

    const step1 = () => flow.trackStep("select_template", 1);
    const step2 = () => flow.trackStep("configure_agents", 2);
    // ...
  }

---

## specialized hooks

from @/hooks/use-analytics:

### usetrackchain

  import { useTrackChain } from "@/hooks/use-analytics";

  function ChainEditor({ chain }) {
    const track = useTrackChain();

    useEffect(() => track.view(chain.id, chain.name), [chain]);

    const handleSave = () => track.save(chain.id, true);
    const handleRun = () => track.runStart(chain.id);
    const handleComplete = (success) => track.runComplete(success);
  }

### usetrackagent

  const { start, message, end } = useTrackAgent();
  start("claude-opus");
  message(sessionId, true);
  end(sessionId, 10, 30000);

### usetrackform

  const { start, submit } = useTrackForm("login");
  start(); // when form is mounted/focused
  submit(true, []); // on submit

### usetrackerror

  const trackError = useTrackError();
  try { ... } catch (e) { trackError(e, { context: "save" }); }

### usetracksearch

  const trackSearch = useTrackSearch("chains");
  trackSearch("agent", 5);

### usetrackengagement

  const { start, end } = useTrackEngagement("chain", "123");
  start(); // when user opens something
  end(); // when they leave

### usetrackmodal

  const trackModal = useTrackModal("settings");
  trackModal("open");
  trackModal("close");
  trackModal("submit");

### usetracktemplate

  const trackTemplate = useTrackTemplate();
  trackTemplate(templateId, category);

### usetrackfeature

  const trackFeature = useTrackFeature("visual_editor");
  trackFeature("drag_node", { nodeType: "agent" });

---

## custom dimensions

ga4: registered in ga4 console first, then use:

  analytics.track({
    name: "chain_created",
    params: {
      custom_namespace: "acme",  // must match ga4 custom dim name
      custom_agent_count: 5
    }
  });

plausible: uses props:

  analytics.track({
    name: "chain_created",
    params: {
      namespace: "acme",
      agentCount: 5
    }
  });

---

## user flows

common flows in mentiko:

chain_creation (5 steps):
  1. select_template
  2. configure_agents
  3. set_parameters
  4. validate
  5. save

chain_run (5 steps):
  1. run_start
  2. configure
  3. validation
  4. execute
  5. complete

agent_session (3 steps):
  1. start
  2. interact
  3. end

---

## event naming conventions

use past tense for actions:
  button_clicked
  form_submitted
  chain_created
  agent_started

use snake_case:
  view_chain
  run_chain
  save_template

---

## privacy considerations

plausible: privacy-first by default
  no cookies
  no personal data collection
  ip addresses not stored

ga4: configure for privacy
  disable ip collection in console
  enable data retention settings
  respect consent requirements

both:
  never send sensitive data
  avoid pii (emails, ids, names)
  hash user ids if needed

---

## testing

analytics disabled in dev unless NEXT_PUBLIC_ANALYTICS_DEBUG=true.

to test events:

1. enable debug mode
2. open browser console
3. interact with app
4. check console for [plausible] or [ga4] logs

---

## migration from none to provider

1. add env vars for chosen provider
2. enable debug mode in dev
3. test events in console
4. deploy to staging
5. verify in analytics dashboard
6. deploy to production
