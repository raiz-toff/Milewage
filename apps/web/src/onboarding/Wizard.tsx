import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { unwrap } from '../api/client';
import type { Country } from '../countries';
import { useSession, useSettings } from '../session';
import { STEPS } from './steps';
import type { OnboardingCtx } from './steps';

const path = (id: string) => `/onboarding/${id}`;

/**
 * The first-run wizard (plan 23), after the recovery key and before the dashboard. One question
 * per step; the URL names the step, so the browser's Back works and a reload resumes there.
 */
export function Onboarding() {
  const { api, setSettings } = useSession();
  const settings = useSettings();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const heading = useRef<HTMLHeadingElement>(null);
  const [countries, setCountries] = useState<Country[] | null>(null);

  useEffect(() => {
    let live = true;
    unwrap(api.GET('/countries'))
      .then((l) => live && setCountries(l))
      .catch(() => live && setCountries([])); // without the list, the steps that need it hide
    return () => {
      live = false;
    };
  }, [api]);

  const ctx: OnboardingCtx = {
    settings,
    country: countries?.find((c) => c.code === settings.country),
  };
  const visible = countries ? STEPS.filter((s) => s.visible(ctx)) : [];
  const id = /^\/onboarding\/([^/]+)/.exec(pathname)?.[1];
  const index = visible.findIndex((s) => s.id === id);
  const step = visible[index];

  const finish = useCallback(async () => {
    setSettings(await unwrap(api.PATCH('/settings', { body: { onboarded: true } })));
    navigate('/dashboard', { replace: true });
  }, [api, navigate, setSettings]);

  // No step in the URL (or one that does not apply): resume at the first unfinished step.
  const resumeAt =
    countries && !step ? (visible.find((s) => !s.done(ctx)) ?? visible.at(-1)) : null;
  useEffect(() => {
    if (!countries || step) return;
    if (resumeAt) navigate(path(resumeAt.id), { replace: true });
    else void finish();
  }, [countries, step, resumeAt, navigate, finish]);

  const title = step ? `${step.title} — Step ${index + 1} of ${visible.length}` : null;
  useEffect(() => {
    if (!title) return;
    const before = document.title;
    document.title = `${title} — MileWage`;
    heading.current?.focus();
    return () => {
      document.title = before;
    };
  }, [title]);

  if (!step) return <p className="p-8 text-center text-muted-foreground">Loading</p>;
  const next = () => {
    const after = visible[index + 1];
    if (after) navigate(path(after.id));
    else void finish();
  };
  const before = visible[index - 1];

  return (
    <div className="min-h-svh bg-background px-4 py-8 sm:py-16">
      <div className="mx-auto grid w-full max-w-xl gap-4">
        <p className="text-sm font-medium text-muted-foreground">Set up MileWage</p>
        {before ? (
          <Link
            to={path(before.id)}
            className="flex w-fit items-center gap-1 text-sm underline-offset-4 hover:underline"
          >
            <ChevronLeft className="size-4" />
            Back
          </Link>
        ) : null}
        <Card>
          <CardHeader>
            <h1 ref={heading} tabIndex={-1} className="text-xl font-semibold outline-none">
              {title}
            </h1>
          </CardHeader>
          <CardContent>
            <step.Component key={step.id} ctx={ctx} next={next} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
