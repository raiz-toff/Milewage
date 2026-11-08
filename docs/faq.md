# Questions and answers

## How much battery does it use?

The target is under 3.5 percent per hour of tracking. It has not been measured on a real phone yet, so treat that as a goal, not a result.

## Does it track me when I am off shift?

No. Nothing records until you start a shift, and it stops when you end it.

## Who can see my data?

Only you, on your own server. There is no MileWage cloud. A few things do leave your setup:

- **Map tiles.** When a map is shown, your browser loads tiles from OpenFreeMap. OpenFreeMap can see which area you looked at. It does not get your shifts.
- **Tailscale.** It carries the traffic between your phone and your server.
- **An AI assistant, if you turn it on.** That option is off by default. If you enable it, the assistant you connect can read what you allow it to read.

Your server also serves a Privacy page at `/privacy`.

## Which countries work?

Canada, the United States and Great Britain have country packs. All of their rates are unverified. Only Canada has a tax estimate. Anywhere else you can still track miles and enter your own rate.

## Can I use it without Tailscale?

Not in this version. The release app only connects over https, and it refuses plain http. Tailscale gives your home server a safe https address without opening anything on your router.

## Can I run it on a Raspberry Pi?

That is the aim, but the image has not been built or tested for ARM yet.

## Does it work on an iPhone?

Not yet. The phone app is Android only.

## How do I update?

Follow [`infra/docs/upgrade.md`](../infra/docs/upgrade.md). Take a backup first. The server takes its own backup before changing the database, and it stays read-only if an upgrade fails.

## Are my data backed up?

Yes. The server makes an encrypted backup every night and after a shift ends. You can download a copy from the Backups page. Keep a copy on another machine, because a backup on the same disk is not a safe backup.

## What if I forget the recovery key?

Then your backups cannot be read, by you or by anyone else. The server never stores the key. The data on the running server is not affected.

## Can several drivers share one server?

No. There is one owner account. Each driver should run their own server.

## Is the active and deadhead split exact?

No. It is an estimate and is labelled that way. Your total miles do not depend on it. See [Active and deadhead miles](active-and-deadhead.md).

## Where is the source code, and what is the licence?

The code is on the owner's private git server today. A licence has not been chosen yet, so for now nobody has been given the right to reuse the code.
