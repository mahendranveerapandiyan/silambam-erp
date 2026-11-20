# Going live – low-cost deployment (≈ ₹0–900 / month)

Everything runs on **one small Linux server**: the app, PostgreSQL, automatic HTTPS and nightly backups.
Measured: the app uses ~130 MB RAM, so a **1 GB** server is enough for 5 branches / ~1,000 students / 500 staff.

## 1. Get a server (pick one)

| Option | Approx. cost | Notes |
|---|---|---|
| AWS Lightsail – Mumbai, 1 GB plan | ~$5 / month | Simple fixed price, India region |
| Hostinger VPS (KVM 1), India | ~₹450–600 / month | Often 4 GB RAM at this price |
| DigitalOcean – Bangalore, 1 GB | ~$6 / month | Very easy panel |
| Oracle Cloud Always Free – Mumbai/Hyderabad | ₹0 | Free, but sign-up can be difficult and idle free servers may be reclaimed – keep backups off the server |

*Prices change – check the provider's site.* Choose **Ubuntu 24.04** (or 22.04). Open ports **22, 80, 443** in the provider's firewall if it has one.

## 2. Address (domain)

- **Free:** skip it. Setup uses `<server-ip>.sslip.io` (e.g. `13-233-10-5.sslip.io`), which already gets a real HTTPS certificate.
- **Own domain (~₹800/year):** create a DNS **A record** such as `erp.yourschool.in → <server IP>` *before* running setup.

## 3. Install (about 10 minutes)

SSH into the server, then:

```bash
sudo apt-get update && sudo apt-get install -y git
git clone https://github.com/mahendranveerapandiyan/silambam-erp.git
cd silambam-erp
sudo bash deploy/setup.sh                      # asks for the domain (Enter = free sslip.io)
```

Variants: `sudo bash deploy/setup.sh erp.yourschool.in` · add `--demo` as the 2nd argument to load demo data.

The script adds swap, installs Docker, writes `deploy/.env` with random passwords, builds and starts everything,
creates the database and prints the address. Log in as **admin / admin123** and change the password immediately.

Then, in the app: **Configuration → Enterprise** (name, logo) → Locations, Legal Employer, Business Units (your 5 branches),
Classes, Sections → **Academic Years** → Grades → **Fee Structures** → hire staff / assign class incharges → admit students.

## 4. Everyday operations

| Task | Command (in the `silambam-erp` folder) |
|---|---|
| Update to the latest version | `sudo bash deploy/deploy.sh` (backs up first, keeps data) |
| See status | `cd deploy && sudo docker compose ps` |
| See app logs | `cd deploy && sudo docker compose logs -f app` |
| Backup now | `cd deploy && sudo docker compose exec backup sh /backup.sh` |
| Restore a backup | `sudo bash deploy/restore.sh deploy/backups/silambam-YYYYMMDD-HHMM.dump` |
| Restart | `cd deploy && sudo docker compose restart` |

**Backups** run every night at 02:00 IST into `deploy/backups/` and are kept 14 days (change `BACKUP_KEEP_DAYS` / `BACKUP_TIME` in `deploy/.env`).
A copy on the same server does not survive the server being deleted – also enable your provider's snapshot/backup add-on
(~₹100–200/month) **or** download a backup weekly:

```bash
scp user@SERVER:silambam-erp/deploy/backups/silambam-*.dump .
```

## 5. Security checklist
- Change `admin` password on first login; give every staff member their own login.
- Keep `deploy/.env` private (it holds the database password and session key).
- Run `sudo apt-get upgrade` monthly; `sudo bash deploy/deploy.sh` for app updates.
