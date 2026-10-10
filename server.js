
const express = require("express");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_FILE =
    process.env.DATA_FILE ||
    path.join(__dirname, "locations.jsonl");

app.disable("x-powered-by");

app.use(express.json({ limit: "10kb" }));

app.use(
    express.static(path.join(__dirname, "public"))
);

function bacaLokasi() {
    if (!fs.existsSync(DATA_FILE)) {
        return [];
    }

    return fs.readFileSync(DATA_FILE, "utf8")
        .split(/\r?\n/)
        .filter(Boolean)
        .map(function (baris) {
            try {
                return JSON.parse(baris);
            } catch {
                return null;
            }
        })
        .filter(Boolean)
        .reverse();
}

function samaSecaraAman(nilai, pembanding) {
    const a = Buffer.from(nilai);
    const b = Buffer.from(pembanding);

    return a.length === b.length &&
        crypto.timingSafeEqual(a, b);
}

function mintaLogin(res) {
    res.set(
        "WWW-Authenticate",
        'Basic realm="Admin Lokasi", charset="UTF-8"'
    );

    return res.status(401).send("Login pemilik diperlukan.");
}

function lindungiAdmin(req, res, next) {
    const adminUser = process.env.ADMIN_USER;
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminUser || !adminPassword) {
        return res.status(503).send(
            "ADMIN_USER dan ADMIN_PASSWORD belum diatur."
        );
    }

    const authorization = req.headers.authorization || "";

    if (!authorization.startsWith("Basic ")) {
        return mintaLogin(res);
    }

    try {
        const decoded = Buffer.from(
            authorization.slice(6),
            "base64"
        ).toString("utf8");

        const pemisah = decoded.indexOf(":");

        if (pemisah < 0) {
            return mintaLogin(res);
        }

        const username = decoded.slice(0, pemisah);
        const password = decoded.slice(pemisah + 1);

        if (
            !samaSecaraAman(username, adminUser) ||
            !samaSecaraAman(password, adminPassword)
        ) {
            return mintaLogin(res);
        }

        res.set("Cache-Control", "no-store");
        next();
    } catch {
        return mintaLogin(res);
    }
}

app.post("/api/location", function (req, res) {
    const data = req.body;

    if (!data || data.consent !== true) {
        return res.status(400).json({
            error: "Persetujuan pembagian lokasi diperlukan."
        });
    }

    const latitude = data.latitude;
    const longitude = data.longitude;
    const accuracy = data.accuracy;

    if (
        typeof latitude !== "number" ||
        !Number.isFinite(latitude) ||
        latitude < -90 ||
        latitude > 90 ||
        typeof longitude !== "number" ||
        !Number.isFinite(longitude) ||
        longitude < -180 ||
        longitude > 180 ||
        typeof accuracy !== "number" ||
        !Number.isFinite(accuracy) ||
        accuracy < 0
    ) {
        return res.status(400).json({
            error: "Data lokasi tidak valid."
        });
    }

    const catatan = {
        latitude: latitude,
        longitude: longitude,
        accuracy: accuracy,
        receivedAt: new Date().toISOString()
    };

    try {
        fs.mkdirSync(path.dirname(DATA_FILE), {
            recursive: true
        });

        fs.appendFileSync(
            DATA_FILE,
            JSON.stringify(catatan) + "\n",
            "utf8"
        );

        return res.status(201).json({
            success: true,
            message: "Lokasi berhasil diterima."
        });
    } catch (error) {
        console.error("Gagal menyimpan lokasi:", error.message);

        return res.status(500).json({
            error: "Server gagal menyimpan lokasi."
        });
    }
});

function escapeHtml(nilai) {
    return String(nilai).replace(/[&<>"']/g, function (karakter) {
        const pengganti = {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        };

        return pengganti[karakter];
    });
}

app.get("/admin", lindungiAdmin, function (req, res) {
    const lokasi = bacaLokasi();

    const baris = lokasi.map(function (item) {
        const lat = Number(item.latitude);
        const lon = Number(item.longitude);
        const akurasi = Number(item.accuracy);

        if (
            !Number.isFinite(lat) ||
            !Number.isFinite(lon) ||
            !Number.isFinite(akurasi)
        ) {
            return "";
        }

        const waktu = new Date(item.receivedAt);

        const waktuTampil = Number.isNaN(waktu.getTime())
            ? "Waktu tidak valid"
            : waktu.toLocaleString("id-ID", {
                timeZone: "Asia/Jakarta"
            });

        const mapsUrl =
            `https://www.google.com/maps?q=${lat},${lon}`;

        return `
            <tr>
                <td>${escapeHtml(waktuTampil)}</td>
                <td>${lat}, ${lon}</td>
                <td>±${Math.round(akurasi)} meter</td>
                <td>
                    <a href="${mapsUrl}"
                       target="_blank"
                       rel="noopener noreferrer">
                       Buka Peta
                    </a>
                </td>
            </tr>
        `;
    }).join("");

    res.type("html").send(`
        <!DOCTYPE html>
        <html lang="id">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport"
                  content="width=device-width, initial-scale=1">
            <title>Admin Lokasi</title>

            <style>
                body {
                    font-family: Arial, sans-serif;
                    margin: 24px;
                    color: #222;
                }

                h1 {
                    font-size: 25px;
                }

                .table-wrap {
                    overflow-x: auto;
                }

                table {
                    width: 100%;
                    border-collapse: collapse;
                    margin-top: 20px;
                }

                th, td {
                    padding: 12px;
                    border: 1px solid #ddd;
                    text-align: left;
                    white-space: nowrap;
                }

                th {
                    background: #f0f4f8;
                }
            </style>
        </head>

        <body>
            <h1>Dashboard Lokasi</h1>
            <p>Jumlah catatan lokasi: ${lokasi.length}</p>
            <p>
                Data waktu, koordinat, dan akurasi
                lokasi yang dikirim ke server.
            </p>

            <div class="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>Waktu diterima</th>
                            <th>Koordinat</th>
                            <th>Akurasi perkiraan</th>
                            <th>Peta</th>
                        </tr>
                    </thead>

                    <tbody>
                        ${baris || `
                            <tr>
                                <td colspan="4">
                                    Belum ada lokasi yang dibagikan.
                                </td>
                            </tr>
                        `}
                    </tbody>
                </table>
            </div>
        </body>
        </html>
    `);
});

app.listen(PORT, "0.0.0.0", function () {
    console.log(`Website berjalan pada port ${PORT}`);
});
