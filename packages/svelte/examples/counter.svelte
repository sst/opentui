<script>
  let count = $state(0);

  setInterval(() => {
    count += 1;
  }, 1000);
</script>

<div>
  <div>Counter: {count}</div>
  <div>Press Ctrl+C to exit</div>
</div>
