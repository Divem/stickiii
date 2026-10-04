#import <Cocoa/Cocoa.h>
#import <ApplicationServices/ApplicationServices.h>
#include <unistd.h>

// A separate QA process takes focus before sending one real mouse click to the
// isolated app. DOM .click() bypasses macOS first-mouse delivery entirely.
int main(int argc, const char *argv[]) {
    if (argc != 4 || !CGPreflightPostEventAccess()) {
        fprintf(stderr, "Native click QA requires a target PID, offsets and existing event access.\n");
        return 1;
    }
    pid_t target = (pid_t)atoi(argv[1]);
    double offsetX = atof(argv[2]), offsetY = atof(argv[3]);
    @autoreleasepool {
        [NSApplication sharedApplication];
        [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
        NSWindow *focusWindow = [[NSWindow alloc]
            initWithContentRect:NSMakeRect(20, 20, 160, 80)
            styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
        focusWindow.title = @"Stickiii QA Focus";
        [focusWindow makeKeyAndOrderFront:nil];
        [NSApp activateIgnoringOtherApps:YES];
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 700 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
            if (!NSApp.active) {
                fprintf(stderr, "Native click QA could not take focus.\n");
                exit(1);
            }
            NSDictionary *bounds = nil;
            for (int attempt = 0; attempt < 50 && !bounds; attempt++) {
                if (attempt > 0) usleep(100 * 1000);
                NSArray *windows = CFBridgingRelease(CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly, kCGNullWindowID));
                double bestArea = 0;
                for (NSDictionary *window in windows) {
                    if ([window[(__bridge NSString *)kCGWindowOwnerPID] intValue] != target) continue;
                    NSDictionary *candidate = window[(__bridge NSString *)kCGWindowBounds];
                    double area = [candidate[@"Width"] doubleValue] * [candidate[@"Height"] doubleValue];
                    const BOOL mainLayer = [window[(__bridge NSString *)kCGWindowLayer] intValue] == 0;
                    if (mainLayer || !bounds) {
                        if (mainLayer || area > bestArea) {
                            bounds = candidate;
                            bestArea = area;
                        }
                    }
                }
            }
            if (!bounds) {
                fprintf(stderr, "Native click QA target window is unavailable.\n");
                exit(1);
            }
            CGPoint point = CGPointMake([bounds[@"X"] doubleValue] + offsetX, [bounds[@"Y"] doubleValue] + offsetY);
            CGEventRef down = CGEventCreateMouseEvent(NULL, kCGEventLeftMouseDown, point, kCGMouseButtonLeft);
            CGEventRef up = CGEventCreateMouseEvent(NULL, kCGEventLeftMouseUp, point, kCGMouseButtonLeft);
            CGEventSetIntegerValueField(down, kCGMouseEventClickState, 1);
            CGEventSetIntegerValueField(up, kCGMouseEventClickState, 1);
            CGEventPost(kCGHIDEventTap, down);
            CGEventPost(kCGHIDEventTap, up);
            CFRelease(down);
            CFRelease(up);
            dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 200 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
                [NSApp terminate:nil];
            });
        });
        [NSApp run];
    }
    return 0;
}
