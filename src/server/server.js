const express = require('express');
const uploadHandler = require('./uploadHandler');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/', uploadHandler);

app.listen(3000, () => {
  console.log('Server running at http://localhost:3000');
});