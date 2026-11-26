# Fashinto ERP

One place to run the business: stock, orders, customers and customer chats.

## What it does

- **Inventory** — products with a size × color stock grid, photos and videos with tags, low-stock alerts, and a history of every stock change.
- **Orders** — create an order, stock goes down automatically. Cancel or return it, stock goes back.
- **Customers** — saved automatically from orders (matched by phone number).
- **Inbox** — WhatsApp, Instagram and Messenger chats in one screen, with saved replies and keyword auto replies.
- **Staff** — owners add, edit and remove staff logins.

## Where things live

| Thing | Where | Cost to start |
| --- | --- | --- |
| Database (all your data) | [Supabase](https://supabase.com) — hosted Postgres | Free, but **no backups** on the free plan |
| The app itself | [Vercel](https://vercel.com) | Free for non-commercial use; a business needs Pro |
| Photos and videos | Vercel Blob | Free up to 1 GB |
| Code | This GitHub repository | Free |

## Before relying on it for the business

- **Backups.** Supabase's free plan keeps no backups and pauses a project
  after a week without activity. Move to the Pro plan (daily backups) before
  the data matters.
- **Vercel plan.** The Hobby plan is for personal, non-commercial use.
- **Lists** show the newest 200 orders and 300 products or customers; older
  ones are found with search.
- **Chats** are built but not connected to Meta yet.

## Going live (one time)

1. Create a Supabase project. Copy its connection string
   (Connect → **Session pooler**).
2. Create a Vercel project from this GitHub repository.
3. In Vercel, add an environment variable `DATABASE_URL` with that connection string.
4. Deploy. The database tables are created automatically on each deploy.
5. Open the site. The first visit asks you to create the owner account.

## Product photos and videos

Files are kept in Vercel Blob. In Vercel open **Storage**, create a **Blob**
store with **public** access, connect it to this project and redeploy. Until
then the upload box on a product shows a short note instead.

## Connecting chats (later)

Chats come through a Meta (Facebook) developer app. Add these in Vercel when ready
(see `.env.example`):

- `META_VERIFY_TOKEN`, `META_APP_SECRET` — for receiving messages
- `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` — for WhatsApp replies
- `META_PAGE_TOKEN` — for Instagram and Messenger replies

The webhook address to give Meta is shown in the app under **Settings**.

## For developers

```bash
cp .env.example .env.local   # then fill in DATABASE_URL
npm install
npm run db:migrate           # create / update tables
npm run dev
```

- Next.js (App Router) + Drizzle ORM + Postgres.
- Tables are defined in `src/db/schema.ts`. After changing it run
  `npm run db:generate`, then `npm run db:migrate`.
- All stock changes go through `changeStock` in `src/lib/stock.ts`.
- Chat sending/receiving is in `src/lib/chat.ts`; Meta calls
  `/api/webhooks/meta`.
- Uploads go straight from the browser to Vercel Blob (`src/lib/media.ts`).
  For local development set `MEDIA_LOCAL_DIR=.uploads` to save files on disk.
