// Makes the Zovo demo databases (made-up shop data) with Jackcess. usage: make.groovy <out.accdb|out.mdb> <variant a|b>
import com.healthmarketscience.jackcess.*
import java.time.*

def out = new File(args[0]); def variant = args[1]
out.delete()
def fmt = out.name.toLowerCase().endsWith('.mdb') ? Database.FileFormat.V2003 : Database.FileFormat.V2010
def db = new DatabaseBuilder(out).setFileFormat(fmt).create()
def rnd = new Random(variant == 'a' ? 1907 : 1907)
def col = { n, t -> new ColumnBuilder(n, t) }

def cities = [['Lisbon','Portugal'],['Porto','Portugal'],['Lyon','France'],['Ghent','Belgium'],['Leeds','United Kingdom'],['Graz','Austria'],['Turku','Finland'],['Bergen','Norway'],['Kraków','Poland'],['Málaga','Spain'],['Aarhus','Denmark'],['Utrecht','Netherlands']]
def first = ['Ana','Bruno','Clara','Daan','Elif','Farah','Goran','Hana','Ivo','Jonas','Kai','Lena','Marta','Nils','Olga','Pia','Rui','Sara','Tomas','Una','Vera','Yusuf','Zofia','Emil']
def last = ['Silva','Moreau','Peeters','Walsh','Gruber','Virtanen','Hansen','Nowak','García','Jensen','de Vries','Costa','Lefebvre','Novak','Berg','Kowalski']

def customers = new TableBuilder('Customers')
  .addColumn(col('CustomerID', DataType.LONG).setAutoNumber(true))
  .addColumn(col('Name', DataType.TEXT).setLengthInUnits(80))
  .addColumn(col('City', DataType.TEXT).setLengthInUnits(50))
  .addColumn(col('Country', DataType.TEXT).setLengthInUnits(50))
  .addColumn(col('Email', DataType.TEXT).setLengthInUnits(120))
  .addColumn(col('Joined', DataType.SHORT_DATE_TIME))
  .addColumn(col('Active', DataType.BOOLEAN))
  .addColumn(col('Notes', DataType.MEMO))
def custB = customers
if (variant == 'b') custB = custB.addColumn(col('Phone', DataType.TEXT).setLengthInUnits(30))
customers = custB.setPrimaryKey('CustomerID').toTable(db)
int nCust = variant == 'a' ? 48 : 52
for (int i = 0; i < nCust; i++) {
  def f = first[i % first.size()], l = last[(i * 7) % last.size()], c = cities[(i * 5) % cities.size()]
  def note = i % 6 == 0 ? "Prefers delivery before noon.\nCall ahead: the shop door is around the corner.\n<b>tags are text here</b> & so is this." : (i % 4 == 0 ? 'Wholesale customer since the first year.' : null)
  customers.addRow(Column.AUTO_NUMBER, "$f $l", c[0], c[1], "${f.toLowerCase()}.${l.toLowerCase().replace(' ', '')}@example.com", LocalDateTime.of(2019 + i % 6, 1 + i % 12, 1 + (i * 3) % 28, 0, 0), i % 9 != 0, note, *(variant == 'b' ? [String.format('+351 900 %03d', i)] : []))
}

def cats = ['Tea', 'Coffee', 'Cups', 'Kettles', 'Snacks']
def products = new TableBuilder('Products')
  .addColumn(col('ProductID', DataType.LONG).setAutoNumber(true))
  .addColumn(col('SKU', DataType.TEXT).setLengthInUnits(20))
  .addColumn(col('ProductName', DataType.TEXT).setLengthInUnits(100))
  .addColumn(col('Category', DataType.TEXT).setLengthInUnits(30))
  .addColumn(col('UnitPrice', DataType.MONEY))
  .addColumn(col('InStock', DataType.INT))
  .addColumn(col('WeightKg', DataType.DOUBLE))
  .addColumn(col('Discontinued', DataType.BOOLEAN))
  .addColumn(col('Picture', DataType.OLE))
  .setPrimaryKey('ProductID').toTable(db)
def names = ['Sencha Green','Assam Breakfast','Earl Grey Blue','Rooibos Vanilla','Jasmine Pearls','Colombia Huila','Ethiopia Guji','House Espresso','Decaf Brazil','Stone Mug','Glass Cup 250 ml','Travel Tumbler','Gooseneck Kettle','Stove Kettle 1.5 l','Oat Biscuits','Almond Thins','Dark Chocolate 70%','Matcha Ceremonial','Chai Masala','Cold Brew Bag']
def png = Base64.decoder.decode('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAGElEQVR4nGNgYGD4z4AFMOGSGJWgRAIAvUoBDzFm1TgAAAAASUVORK5CYII=')
int nProd = names.size()
for (int i = 0; i < nProd; i++) {
  def cat = i < 9 ? (i < 5 || i >= 17 ? 'Tea' : 'Coffee') : (i < 12 ? 'Cups' : (i < 14 ? 'Kettles' : 'Snacks'))
  if (i >= 17) cat = 'Tea'
  def price = new BigDecimal(String.format(Locale.ROOT, '%.2f', 3.5 + ((i * 37) % 60) / 2.0))
  if (variant == 'b' && i == 2) price = price + 1.00
  products.addRow(Column.AUTO_NUMBER, String.format('ZV-%04d', 1001 + i), names[i], cat, price, (i * 13) % 90, 0.05 + ((i * 7) % 20) / 10.0, i == 8, i % 5 == 0 ? png : null)
}

def orders = new TableBuilder('Orders')
  .addColumn(col('OrderID', DataType.LONG).setAutoNumber(true))
  .addColumn(col('CustomerID', DataType.LONG))
  .addColumn(col('OrderDate', DataType.SHORT_DATE_TIME))
  .addColumn(col('ShipCity', DataType.TEXT).setLengthInUnits(50))
  .addColumn(col('Status', DataType.TEXT).setLengthInUnits(20))
  .addColumn(col('Total', DataType.MONEY))
  .setPrimaryKey('OrderID').toTable(db)
def lines = new TableBuilder('OrderLines')
  .addColumn(col('LineID', DataType.LONG).setAutoNumber(true))
  .addColumn(col('OrderID', DataType.LONG))
  .addColumn(col('ProductID', DataType.LONG))
  .addColumn(col('Quantity', DataType.INT))
  .addColumn(col('UnitPrice', DataType.MONEY))
  .addColumn(col('Discount', DataType.FLOAT))
  .setPrimaryKey('LineID').toTable(db)
def statuses = ['Shipped', 'Shipped', 'Shipped', 'Delivered', 'Open', 'Returned']
int nOrd = variant == 'a' ? 240 : 255
for (int o = 1; o <= nOrd; o++) {
  int cust = 1 + (o * 17) % nCust
  int nl = 1 + (o * 7) % 4
  BigDecimal total = 0
  for (int k = 0; k < nl; k++) {
    int p = 1 + (o * 11 + k * 5) % nProd
    int q = 1 + (o + k) % 6
    def up = new BigDecimal(String.format(Locale.ROOT, '%.2f', 3.5 + (((p - 1) * 37) % 60) / 2.0))
    float disc = (o % 10 == 0) ? 0.1f : 0f
    lines.addRow(Column.AUTO_NUMBER, o, p, q, up, disc)
    total += up * q * (1 - disc)
  }
  orders.addRow(Column.AUTO_NUMBER, cust, LocalDateTime.of(2025, 1 + (o * 5) % 12, 1 + (o * 3) % 28, 9 + o % 8, (o * 13) % 60), cities[(cust * 5) % cities.size()][0], statuses[o % statuses.size()], total.setScale(2, java.math.RoundingMode.HALF_UP))
}
if (variant == 'b') {
  def sup = new TableBuilder('Suppliers')
    .addColumn(col('SupplierID', DataType.LONG).setAutoNumber(true))
    .addColumn(col('SupplierName', DataType.TEXT).setLengthInUnits(80))
    .addColumn(col('Country', DataType.TEXT).setLengthInUnits(50))
    .setPrimaryKey('SupplierID').toTable(db)
  sup.addRow(Column.AUTO_NUMBER, 'Hillside Leaf Traders', 'India'); sup.addRow(Column.AUTO_NUMBER, 'Andes Bean Co-op', 'Colombia')
} else {
  def ship = new TableBuilder('Shippers')
    .addColumn(col('ShipperID', DataType.LONG).setAutoNumber(true))
    .addColumn(col('ShipperName', DataType.TEXT).setLengthInUnits(80))
    .addColumn(col('Phone', DataType.TEXT).setLengthInUnits(30))
    .setPrimaryKey('ShipperID').toTable(db)
  ship.addRow(Column.AUTO_NUMBER, 'Swift Parcel', '+351 21 000 0001'); ship.addRow(Column.AUTO_NUMBER, 'Blue Van Freight', '+33 4 00 00 00 02'); ship.addRow(Column.AUTO_NUMBER, 'North Courier', '+47 55 00 00 03')
}
db.close()
println "wrote ${out} ${out.length()} bytes"
