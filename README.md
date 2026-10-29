# GNRD Photobooth

Aplikasi web statis dengan Supabase untuk database, autentikasi, dan Edge Functions.
Frontend disusun dalam `components/`, `css/`, dan `js/`; skema database ada di
`supabase/migrations/`.

## Menjalankan lokal

Persyaratan: Docker Desktop dan Node.js terpasang. Jalankan `npm install` satu
kali setelah mengambil proyek atau saat dependensi berubah. Setiap kali laptop
dinyalakan, jalankan langkah berikut:

1. Buka Docker Desktop dan tunggu sampai statusnya **Running**.
2. Buka PowerShell, lalu masuk ke folder proyek dan mulai Supabase lokal:

   ```powershell
   cd D:\AplikasiDev\gnrd_photobooth
   npx supabase start
   ```

   Biarkan terminal ini tetap terbuka. Tunggu sampai layanan Supabase selesai
   dijalankan. Pada penggunaan pertama, proses ini juga menyiapkan database dan
   menjalankan migrasi.

3. Pastikan `js/config.local.js` berisi URL API dan anon key Supabase lokal.
   Jika file belum ada, jalankan `npx supabase status`, salin
   `js/config.local.example.js` menjadi `js/config.local.js`, lalu isi nilainya
   dari status tersebut. File konfigurasi lokal ini tidak masuk Git dan tidak
   boleh dibagikan. Langkah penyiapan ini hanya diperlukan pertama kali atau
   jika konfigurasi lokal hilang/berubah.

4. Buka PowerShell kedua, masuk ke folder proyek, lalu jalankan Edge Functions:

   ```powershell
   cd D:\AplikasiDev\gnrd_photobooth
   npx supabase functions serve
   ```

   Biarkan terminal ini tetap terbuka.

5. Buka PowerShell ketiga dan jalankan server halaman web:

   ```powershell
   cd D:\AplikasiDev\gnrd_photobooth
   npm run serve
   ```

   Biarkan terminal ini tetap terbuka. Server web menggunakan port `8080`.

   QR konfirmasi dibuat untuk setiap sesi menggunakan IPv4 lokal komputer.
   Pastikan HP customer dan komputer photobooth berada di jaringan Wi-Fi/LAN
   yang sama. HP membuka `confirm.html`, lalu tombol **Mulai Foto** mengirim
   konfirmasi melalui Socket.IO; kios mencatat transaksi dan melanjutkan sesi
   secara otomatis.

6. Buka halaman login yang sesuai di browser:
   - Owner/Admin: `http://localhost:8080/staff-login.html`
   - Operator kios: `http://localhost:8080/login.html`

Jika baru menyiapkan database lokal, buka Supabase Studio di
`http://127.0.0.1:54323`, buat user pertama, lalu tetapkan role `owner` melalui
SQL Editor:

```sql
insert into public.staff_profiles (user_id, role, kiosk_id)
select id, 'owner', null
from auth.users
where lower(email) = lower('EMAIL_OWNER')
on conflict (user_id) do update
set role = 'owner', kiosk_id = null, updated_at = now();
```

Setelah memiliki akun, login melalui halaman Owner/Admin, buat kios di menu
**Kelola Data Kios**, lalu buat akun Admin Kios melalui menu **Kelola Akun Staf**.
Akses operasional photobooth menggunakan kode dan password pada data kios.

Gunakan `npx supabase stop` untuk menghentikan database lokal. Jangan jalankan
`npx supabase db reset` jika ingin mempertahankan data lokal.

## Role

| Role        | Hak akses                                                                                               |
| ----------- | ------------------------------------------------------------------------------------------------------- |
| Owner       | Akses global, termasuk mengelola Admin Pusat                                                            |
| Admin Pusat | Konfigurasi global, seluruh kios, laporan, dan akun lokal                                               |
| Admin Kios  | Mengubah harga dan durasi QRIS, serta melihat ringkasan transaksi untuk kios yang ditugaskan |

Owner dan Admin Pusat dapat menghapus akun staf dari menu **Kelola Akun Staf**.
Admin Pusat hanya dapat menghapus akun Admin Kios; akun Owner tidak dapat dihapus
dari menu tersebut.

Setiap akun Admin Kios dapat ditugaskan ke beberapa kios melalui menu
**Kelola Akun Staf Kios**. Penugasan lama pada `staff_profiles.kiosk_id` otomatis
disalin ke tabel relasi `staff_kiosks` oleh migrasi
`20261028060000_assign_multiple_kiosks_to_admins.sql`; data kios lama tidak
dihapus. Admin Kios dapat memilih kios yang ditangani pada dashboard. Operator
tetap masuk menggunakan kode dan password masing-masing kios.

Setiap akun staf dan operator hanya dapat aktif pada satu perangkat/tab. Login
baru akan menawarkan pemindahan sesi; jika disetujui, perangkat sebelumnya
otomatis kembali ke halaman login. Sesi yang tidak aktif akan dapat diambil
kembali setelah lease berakhir. Terapkan migrasi baru dengan
`npx supabase migration up --local` untuk Supabase lokal atau `npx supabase db push`
untuk project yang ditautkan, lalu deploy fungsi yang diperbarui dengan
`npx supabase functions deploy staff-admin` dan
`npx supabase functions deploy kiosk-revenue`.

Pada database lokal yang sudah pernah dijalankan, terapkan migrasi baru dengan
`npx supabase migration up --local`. Pada project Supabase yang ditautkan,
terapkan migrasi melalui `npx supabase db push` setelah memeriksa project target.

Satu alamat email hanya boleh digunakan oleh satu akun staf dan satu role.

Operator tidak memiliki akun staf terpisah. Akses menjalankan photobooth memakai
kode dan password outlet/kios.

Perubahan dan migrasi database tersimpan di Git. Deployment Pages hanya berjalan
secara manual agar push ke GitHub tidak menerbitkan aplikasi sebelum siap.

<><><><><><><><><><><><><><><><>

Saya ingin me-refactor aplikasi saya. Saat ini, relasi antara Admin Kios dan Kios/Outlet adalah 1-to-1 (users.outlet_id). Saya ingin merubahnya menjadi 1-to-Many agar 1 Admin Kios bisa mengampu beberapa outlet, sedangkan Operator Kios tetap 1-to-1.

Buat skrip agar data lama tidak hilang.

ada fitur dimana admin pusat dapat menambahkan atau menghapus outlet ke admin outlet/kios (1 admin kios memiliki lebih dari satu outlet yang di handle). data outlet yang dipililh hanya data outlet yang sudah didaftarkan ke sistem

<><><><><><><><><><><><><>><><><

Saya ingin mengubah alur halaman konfirmasi pembayaran:

1. Menghilangkan tombol manual 'Konfirmasi Pembayaran' pada halaman scan QRCODE

Mengubah QR Code agar secara dinamis berisi URL yang menunjuk ke IP Lokal server dan menyertakan session_id unik.

Ketika customer meng-scan QR Code pakai HP (dalam Wi-Fi yang sama), HP customer akan membuka halaman web confirm.html yang hanya berisi 1 tombol 'Mulai Foto'.

Saat tombol 'Mulai Foto' di HP customer diklik, sinyal dikirimkan ke server, lalu halaman scan QRCODE di aplikasi Photobooth secara otomatis mendeteksi sinyal tersebut dan berpindah (redirect) ke halaman berikutnya.

Tolong buatkan implementasi kodingan lengkapnya:

1. Logika auto-detect IPv4 lokal menggunakan modul bawaan os.
2. Endpoint API untuk mengembalikan URL QR dinamis dengan session_id baru.
3. Setup server untuk mendengarkan event konfirmasi dari HP customer dan mem-broadcast-nya ke halaman scan QRcode di aplikasi Photobooth.
4. Hapus tombol konfirmasi manual di halaman scan QRCODE.
5. render QR Code dinamis tampilkan di layar (sesuai contoh yang saya kirim).
6. server client listener yang menunggu event session_approved untuk otomatis redirect ke proses selanjutnya.
7. buat Halaman Web Client HP untuk konfirmasi. Buat UI mobile-friendly sederhana berlatar gelap (sesuai tema photobooth) dengan 1 tombol besar 'Mulai Foto'.
8. Tangkap parameter session_id dari URL query string.
9. Kirim socket event confirm_session ke server saat tombol diklik, lalu tampilkan pesan sukses di HP.

lakukan apa yang saya infokan diatas.
