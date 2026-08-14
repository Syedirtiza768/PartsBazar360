"use client";

export function WhatsAppButton() {
  return (
    <a
      href="https://wa.me/971564974989"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Chat with us on WhatsApp"
      className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom,0px))] right-6 z-dropdown flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] shadow-lg transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-[#25D366] focus:ring-offset-2 lg:bottom-6"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 32 32"
        fill="white"
        className="h-8 w-8"
      >
        <path d="M16.004 0h-.008C7.174 0 0 7.176 0 16c0 3.5 1.128 6.744 3.046 9.378L1.054 31.29l6.124-1.96A15.912 15.912 0 0016.004 32C24.826 32 32 24.822 32 16S24.826 0 16.004 0zm9.31 22.6c-.39 1.1-1.932 2.014-3.158 2.28-.84.18-1.934.324-5.628-1.21-4.724-1.966-7.764-6.78-8-7.07-.226-.292-1.902-2.53-1.902-4.826s1.204-3.424 1.632-3.89c.39-.428.924-.628 1.23-.628.152 0 .288.008.41.014.426.018.64.044.92.712.352.84 1.21 2.952 1.316 3.168.108.216.216.508.068.8-.14.3-.264.488-.476.748-.216.26-.42.46-.632.74-.192.244-.404.504-.172.938.232.432 1.032 1.704 2.22 2.76 1.524 1.352 2.804 1.772 3.236 1.968.432.196.688.164.94-.1.252-.264 1.08-1.256 1.372-1.69.288-.432.58-.36.976-.216.396.14 2.508 1.184 2.94 1.4.432.216.72.324.828.504.104.18.104 1.036-.288 2.136z" />
      </svg>
    </a>
  );
}
