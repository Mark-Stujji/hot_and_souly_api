const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- Middleware (runs on every request before the routes) ----------
app.use(cors());          // lets the Flutter web app call this API
app.use(express.json());  // reads JSON bodies into req.body

// Tiny logger: prints e.g. "GET /menu" for every request
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()}  ${req.method} ${req.url}`);
  next();
});

// ---------- Menu data (our "database" for the menu, prices in KSh) ----------
const menu = [
  { id: 1, name: 'The Soul Dog', tag: 'House favourite', description: 'Grilled dog, caramelised onions, tangy house sauce, crispy shallots.', price: 200, category: 'hotdogs', image: 'lib/images/hot-dog.jpg', color: 'B0452F', rating: 4.8, reviews: 126 },
  { id: 2, name: 'Loaded Soul Fries', tag: 'Crispy corner', description: 'Golden fries, cheese sauce, jalapeño, scallion, smoky drizzle.', price: 250, category: 'fries', image: 'lib/images/fries.jpg', color: 'E0B04A', rating: 4.6, reviews: 98 },
  { id: 3, name: 'Street Tacos', tag: 'Two-bite joy', description: 'Soft tortillas, spiced filling, fresh slaw, lime and heat.', price: 150, category: 'tacos', image: 'lib/images/tacos.jpg', color: '5A6648', rating: 4.7, reviews: 84 },
  { id: 4, name: 'Sunset Juice', tag: 'Fresh pour', description: 'Bright, cold-pressed and made for the golden hour.', price: 150, category: 'drinks', image: 'lib/images/juice.png', color: 'CF7545', rating: 4.5, reviews: 61 },
  { id: 5, name: 'Cloud Yoghurt', tag: 'Cool down', description: 'Silky yoghurt, fruit, crunch and a little honey on top.', price: 200, category: 'drinks', image: 'lib/images/yoghurt.png', color: 'E6D3AB', rating: 4.4, reviews: 47 },
];

// ---------- Orders storage ----------
// Kept in memory AND saved to orders.json so they survive a restart.
// (A real product would use a database such as MongoDB or PostgreSQL.)
const ORDERS_FILE = path.join(__dirname, 'orders.json');
let orders = [];
if (fs.existsSync(ORDERS_FILE)) {
  try {
    orders = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8'));
  } catch (e) {
    console.error('Could not read orders.json, starting empty');
  }
}
let nextOrderId = orders.reduce((max, o) => Math.max(max, o.id), 0) + 1;

function saveOrders() {
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
}

// ---------- Routes ----------

// Health check: GET /
app.get('/', (req, res) => {
  res.json({ message: 'Hot & Souly API is running' });
});

// GET /menu                 -> everything
// GET /menu?category=tacos  -> only that category
app.get('/menu', (req, res) => {
  const { category } = req.query;
  if (!category || category === 'all') return res.json(menu);
  res.json(menu.filter((item) => item.category === category));
});

// GET /menu/3 -> one item, or 404
app.get('/menu/:id', (req, res) => {
  const item = menu.find((m) => m.id === Number(req.params.id));
  if (!item) return res.status(404).json({ error: 'Menu item not found' });
  res.json(item);
});

// POST /orders
// Body: { "customerName": "Amina", "phone": "0712345678",
//         "items": [ { "id": 1, "qty": 2 }, { "id": 4, "qty": 1 } ] }
app.post('/orders', (req, res) => {
  const { customerName, phone, items } = req.body;

  // 1) Validate the input -> 400 Bad Request if something is wrong
  if (!customerName || typeof customerName !== 'string' || !customerName.trim()) {
    return res.status(400).json({ error: 'customerName is required' });
  }
  if (!phone || !/^[0-9+\s-]{9,15}$/.test(String(phone))) {
    return res.status(400).json({ error: 'a valid phone number is required' });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items must be a non-empty list' });
  }

  // 2) Build the lines from OUR menu, so the client can't fake prices
  const lines = [];
  for (const entry of items) {
    const dish = menu.find((m) => m.id === Number(entry.id));
    const qty = Number(entry.qty);
    if (!dish) {
      return res.status(400).json({ error: `Unknown menu item id: ${entry.id}` });
    }
    if (!Number.isInteger(qty) || qty < 1 || qty > 50) {
      return res.status(400).json({ error: `Invalid quantity for ${dish.name}` });
    }
    lines.push({ id: dish.id, name: dish.name, price: dish.price, qty, lineTotal: dish.price * qty });
  }

  // 3) Create, save and return the order -> 201 Created
  const order = {
    id: nextOrderId++,
    customerName: customerName.trim(),
    phone: String(phone).trim(),
    items: lines,
    total: lines.reduce((sum, l) => sum + l.lineTotal, 0),
    status: 'received',
    createdAt: new Date().toISOString(),
  };
  orders.push(order);
  saveOrders();
  res.status(201).json(order);
});

// GET /orders -> all orders (handy for checking in the browser)
app.get('/orders', (req, res) => {
  res.json(orders);
});

// GET /admin -> a simple page that shows all orders in a table.
// It calls our own /orders API and builds the rows in the browser.
app.get('/admin', (req, res) => {
  res.send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Hot & Souly orders</title>
  <style>
    body { font-family: sans-serif; margin: 32px; background: #f6efe6; color: #14110f; }
    h1 { margin-bottom: 20px; }
    table { border-collapse: collapse; width: 100%; background: #fffcf7; }
    th, td { padding: 10px 14px; text-align: left; border-bottom: 1px solid #ddd; }
    th { background: #14110f; color: #fff; }
    tr:hover td { background: #faf0e0; }
  </style>
</head>
<body>
  <h1>Hot & Souly orders</h1>
  <table>
    <thead>
      <tr><th>#</th><th>Customer</th><th>Phone</th><th>Items</th><th>Total (KSh)</th><th>Status</th><th>Time</th></tr>
    </thead>
    <tbody id="rows"></tbody>
  </table>
  <script>
    fetch('/orders')
      .then(function (r) { return r.json(); })
      .then(function (orders) {
        var body = document.getElementById('rows');
        // newest order first
        orders.slice().reverse().forEach(function (o) {
          var tr = document.createElement('tr');
          var cells = [
            o.id,
            o.customerName,
            o.phone,
            o.items.map(function (i) { return i.qty + ' x ' + i.name; }).join(', '),
            o.total,
            o.status,
            new Date(o.createdAt).toLocaleString()
          ];
          cells.forEach(function (value) {
            var td = document.createElement('td');
            td.textContent = value; // textContent (not innerHTML) so customer names can't inject HTML
            tr.appendChild(td);
          });
          body.appendChild(tr);
        });
      });
  </script>
</body>
</html>`);
});

// ---------- Errors ----------
// Unknown route -> 404
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Central error handler (4 arguments = Express treats it as an error handler)
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// ---------- Start ----------
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});