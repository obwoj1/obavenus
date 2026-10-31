import AppKit

let side = 1024.0
let image = NSImage(size: NSSize(width: side, height: side))
image.lockFocus()

let card = NSBezierPath(roundedRect: NSRect(x: 32, y: 32, width: 960, height: 960), xRadius: 224, yRadius: 224)
NSGradient(colors: [NSColor(calibratedRed: 0.94, green: 0.965, blue: 0.925, alpha: 1), NSColor(calibratedRed: 0.78, green: 0.85, blue: 0.77, alpha: 1)])!.draw(in: card, angle: -45)

let center = NSPoint(x: 512, y: 512)
let glow = NSBezierPath(ovalIn: NSRect(x: 175, y: 175, width: 674, height: 674))
NSColor(calibratedRed: 0.34, green: 0.52, blue: 0.39, alpha: 0.12).setFill()
glow.fill()

func orbit(_ rect: NSRect, rotation: CGFloat, color: NSColor, width: CGFloat) {
    let ellipse = NSBezierPath(ovalIn: rect)
    let transform = NSAffineTransform()
    transform.translateX(by: center.x, yBy: center.y)
    transform.rotate(byDegrees: rotation)
    transform.translateX(by: -center.x, yBy: -center.y)
    let path = transform.transform(ellipse)
    path.lineWidth = width
    color.setStroke()
    path.stroke()
}

orbit(NSRect(x: 200, y: 402, width: 624, height: 220), rotation: 35, color: NSColor(calibratedRed: 0.27, green: 0.43, blue: 0.32, alpha: 0.92), width: 25)
orbit(NSRect(x: 200, y: 402, width: 624, height: 220), rotation: -35, color: NSColor(calibratedRed: 0.42, green: 0.61, blue: 0.46, alpha: 0.88), width: 25)

let core = NSBezierPath(ovalIn: NSRect(x: 359, y: 359, width: 306, height: 306))
NSGradient(colors: [NSColor(calibratedRed: 0.31, green: 0.49, blue: 0.36, alpha: 1), NSColor(calibratedRed: 0.19, green: 0.34, blue: 0.24, alpha: 1)])!.draw(in: core, angle: -45)
let nucleus = NSBezierPath(ovalIn: NSRect(x: 464, y: 464, width: 96, height: 96))
NSColor(calibratedRed: 0.96, green: 0.98, blue: 0.94, alpha: 1).setFill()
nucleus.fill()

image.unlockFocus()
let destination = CommandLine.arguments.dropFirst().first ?? "assets/Obavenus.png"
let url = URL(fileURLWithPath: destination)
let representation = NSBitmapImageRep(data: image.tiffRepresentation!)!
try representation.representation(using: .png, properties: [:])!.write(to: url)
