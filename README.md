# Fashinto ERP

One place to run the business: stock, orders and customers.

## What it does

- **Products and Inventory** — a photo gallery and a stock table of the same products. Each product page shows its photos, details, purchase batches, a size × color stock grid, sales summary and recent stock activity.
- **Purchases** — every batch of stock bought and what was paid for it.
- **Reports** — sales, units sold, best sellers and what the stock is worth.
- **Search** — products by name or SKU, orders by number or customer, from the box at the top of every page.
- **Orders** — create an order, stock goes down automatically. Cancel or return it, stock goes back.
- **Customers** — saved automatically from orders (matched by phone number).
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
  after a week without activity. Until you move to the Pro plan (daily
  backups), use **Settings → Download backup** every week; the dashboard
  reminds the owner when a week has passed.
- **Recovery code.** Each person can create a one-time code in Settings for
  getting back in after a forgotten password. An owner without one can be
  locked out.
- **Vercel plan.** The Hobby plan is for personal, non-commercial use.
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
- Uploads go straight from the browser to Vercel Blob (`src/lib/media.ts`).
  For local development set `MEDIA_LOCAL_DIR=.uploads` to save files on disk.
