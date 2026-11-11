import { Link } from 'react-router-dom';
import { StepError, StepForm } from './StepForm';
import type { StepProps } from './steps';

/** Every answer with a "Change" link, then Finish (GOV.UK check answers; plan 23 step 7). */
export function CheckStep({ ctx, next, steps }: StepProps) {
  const rows = steps.filter((s) => s.summary);
  const save = async () => {
    if (!ctx.vehicles.length) throw new StepError('Add your vehicle first: a shift needs one.');
  };
  return (
    <StepForm save={save} next={next} skip={null} submit="Finish">
      <dl className="divide-y divide-outline-variant rounded-lg border border-outline-variant text-body-medium">
        {rows.map((s) => (
          <div key={s.id} className="grid gap-1 p-3 sm:grid-cols-[10rem_1fr_auto] sm:gap-4">
            <dt className="text-title-small">{s.title}</dt>
            <dd className="text-muted-foreground">{s.summary!(ctx)}</dd>
            <dd>
              <Link
                to={`/onboarding/${s.id}?change=1`}
                className="rounded-extra-small text-label-large underline decoration-primary decoration-2 underline-offset-4 focus-ring hover:decoration-[3px]"
              >
                Change <span className="sr-only">{s.title.toLowerCase()}</span>
              </Link>
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-body-medium text-muted-foreground">
        You can change all of this later in Settings.
      </p>
    </StepForm>
  );
}
