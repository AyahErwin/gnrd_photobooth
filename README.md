# GNRD Photobooth

Aplikasi web statis dengan Supabase untuk database, autentikasi, dan Edge Functions.
Frontend disusun dalam `components/`, `css/`, dan `js/`; skema database ada di
`supabase/migrations/`.

## Menjalankan lokal

Persyaratan: Docker Desktop, Node.js, dan Python terpasang.

1. Jalankan Docker Desktop.
2. Dari folder proyek, jalankan `npx supabase start`. Migrasi database berjalan
   otomatis saat pertama kali Supabase lokal dimulai.
3. Jalankan `npx supabase status`, lalu salin URL API dan `anon key` lokal.
4. Salin `js/config.local.example.js` menjadi `js/config.local.js` dan isi URL
   serta key tersebut. File lokal ini tidak masuk Git.
5. Di terminal kedua, jalankan `npx supabase functions serve`.
6. Di terminal ketiga, jalankan `python -m http.server 8000`, lalu buka
   `http://127.0.0.1:8000`.
7. Buka Supabase Studio di `http://127.0.0.1:54323`, buat user pertama, lalu
   tetapkan role `owner` melalui SQL Editor:

   ```sql
   insert into public.staff_profiles (user_id, role, kiosk_id)
   select id, 'owner', null
   from auth.users
   where lower(email) = lower('EMAIL_OWNER')
   on conflict (user_id) do update
   set role = 'owner', kiosk_id = null, updated_at = now();
   ```

8. Login melalui `staff-login.html`, buat kios di menu **Kelola Data Kios**, lalu
   buat akun Admin Kios melalui menu **Kelola Akun Staf**. Akses operasional
   photobooth menggunakan kode dan password pada data kios.

Gunakan `npx supabase stop` untuk menghentikan database lokal. Jangan jalankan
`npx supabase db reset` jika ingin mempertahankan data lokal.

## Role

| Role | Hak akses |
| --- | --- |
| Owner | Akses global, termasuk mengelola Admin Pusat |
| Admin Pusat | Konfigurasi global, seluruh kios, laporan, dan akun lokal |
| Admin Kios | Hanya mengubah harga dan durasi QRIS kiosnya |

Operator tidak memiliki akun staf terpisah. Akses menjalankan photobooth memakai
kode dan password outlet/kios.

Perubahan dan migrasi database tersimpan di Git. Deployment Pages hanya berjalan
secara manual agar push ke GitHub tidak menerbitkan aplikasi sebelum siap.
