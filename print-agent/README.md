# FlowXP print agent

A tiny program for the **till computer** that lets FlowXP print receipts and kitchen tickets **without the
print dialog**, and **open the cash drawer**. A web page cannot talk to a printer directly, so this sits on
the computer, listens on `127.0.0.1` only, and passes the print job to the printer.

You do **not** need it to print. Without it FlowXP prints from the browser as before. Use it when you want
one-tap receipts, automatic kitchen tickets, or a drawer that opens on cash.

## What you need

- A thermal receipt printer that speaks **ESC/POS** (almost all 58 mm and 80 mm ones do: Epson TM, Xprinter,
  Rongta, TVS, Star in ESC/POS mode, ...). The cash drawer plugs into the printer's RJ11 "DK" port.
- [Node.js](https://nodejs.org) 18 or newer on the till computer.
- This folder (`print-agent`) copied to that computer.

## Start it

Pick a long secret (this is the "token"); FlowXP will ask for the same one.

```
# Windows (Command Prompt)
set TOKEN=pick-a-long-secret
set ORIGINS=https://app.example.com
node agent.js

# macOS / Linux
TOKEN=pick-a-long-secret ORIGINS=https://app.example.com node agent.js
```

`ORIGINS` is the address you open FlowXP at (use `http://localhost:5174` while testing). If you leave it out,
any website that knows the token can print, which is fine on a private computer but not on a shared one.
`PORT` changes the port (default 9101).

To have it start with the computer: on Windows add a Task Scheduler task "At log on" running
`node C:\flowxp\print-agent\agent.js` with the two variables set (or use [NSSM](https://nssm.cc)); on
macOS/Linux use a launchd/systemd service.

## Tell FlowXP about it

**Business settings, Receipts and kitchen slips, Silent printing** (this is remembered in this browser only):

1. Printing: *Silent, through the print agent*.
2. Agent address: `http://127.0.0.1:9101`, and the token you chose.
3. Receipt printer: where the printer is (below). Kitchen printer is optional; empty means the receipt printer.
4. Tick *Open the cash drawer when a cash payment is taken* if you have a drawer.
5. Press **Print a test page**, then **Test the cash drawer**.

## Where is my printer?

| Printer | Target to enter |
|---|---|
| Network / Wi-Fi / Ethernet printer | `tcp://192.168.1.50:9100` (its IP address; print its self-test page to see it; port is almost always 9100) |
| USB printer on **Windows** | Share the printer in Windows (Printers, Properties, Sharing), then `share://PC-NAME/ShareName` |
| Printer on **macOS / Linux** (CUPS) | `lp://PrinterName` (see `lpstat -p`) |
| USB printer as a device file (Linux) | `file:///dev/usb/lp0` |

A network printer is the least fuss. For a USB printer on Windows, install the printer's driver, share it,
and use the share name (spaces are fine, but avoid `;` and quotes).

## Safety

- It only listens on this computer (`127.0.0.1`), needs the token on every request, and (when `ORIGINS` is set)
  answers only your FlowXP address.
- It only forwards bytes to the printer you name; it cannot run programs or read files. File targets are
  restricted to `/dev`.

## If it does not work

| Message in FlowXP | Meaning |
|---|---|
| Cannot reach the print agent on this computer | The agent is not running, or the address/port is wrong. Chrome may also be blocking a public page from reaching a local address: allow it when asked, and make sure `ORIGINS` matches the address in the browser exactly. |
| Wrong token | The token in FlowXP differs from the one the agent was started with. |
| This website is not allowed to print here | `ORIGINS` does not include the address you opened FlowXP at. |
| Could not reach the printer at ... | The printer is off, unplugged, or on another network. |
| Prints but shows odd symbols | The printer uses a different character set; FlowXP sends plain ASCII and writes the rupee sign as `Rs`, so this is rare. Check the printer is in ESC/POS mode. |
| Nothing prints, no error | Some printers ignore raw jobs on a shared USB connection; try a network connection, or the vendor's raw/"generic text" driver. |

When a silent print fails, FlowXP falls back to the normal browser print view so the receipt is never lost.

## Not using the agent: Chrome's kiosk printing

If you only want to skip the print dialog (no drawer), start Chrome with `--kiosk-printing`; it then prints
`window.print()` straight to the default printer. Set the thermal printer as the Windows default and switch
on *Print the receipt automatically after billing* in Business settings.
